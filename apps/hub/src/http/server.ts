import {
  CURSOR_SIGNATURE_HEADER,
  mapCursorStatusChangeToSignal,
  verifyCursorSignature,
} from "@aspex/adapter-cursor";
import { normalizeWebhookBody } from "@aspex/adapter-webhook";
import type {
  ActionResult,
  DispatchIntent,
  IntentAck,
  Source,
  StatusQueryIntent,
  StatusReport,
} from "@aspex/schema";
import {
  assertDirectionIntent,
  assertSignal,
  isValidIntentId,
} from "@aspex/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bus } from "../bus";
import { rank } from "../engine/attention";
import type { VoiceGateway } from "../voice/gateway";
import type { WorldModel } from "../world/worldModel";
import { hubAuth } from "./auth";
import {
  IntentLedger,
  type LedgerEntry,
  type LedgerResult,
  requestFingerprint,
} from "./intentLedger";
import {
  PROBLEM_TYPES,
  isProblemBody,
  problem,
  problemBody,
  problemResponse,
} from "./problems";
import {
  type SseBroadcaster,
  createSseBroadcaster,
  createStateStream,
} from "./sse";
import { registerVoiceRoutes } from "./voice";

// Wire-protocol version advertised in GET /state (protocol v1.1, B7): the
// versioning slot for additive-only evolution; there is no /v1 path prefix.
// Clients must ignore unknown fields and unknown SSE event types.
export const HUB_API_VERSION = "1.1";

// Marks a response that was answered from the idempotency ledger (a recorded
// replay or a joined in-flight request) instead of executing again.
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";

export interface ServerDeps {
  worldModel: WorldModel;
  bus: Bus;
  cap: number;
  version: string;
  // Local bearer token required on every endpoint (ADR-0023). When omitted the
  // app is unauthenticated; the Hub boot path always supplies one.
  authToken?: string;
  // One extra exact origin allowed by CORS (the XR lab client), alongside
  // the built-in tauri://localhost and http://localhost:*.
  corsOrigin?: string;
  dispatchAction: (
    itemId: string,
    actionId: string,
    payload?: unknown,
  ) => Promise<ActionResult>;
  actionMeta: (
    itemId: string,
    actionId: string,
  ) => { requiresConfirmation: boolean; label?: string } | null;
  // Referent-less direction verbs (design 2.4): dispatch new work and
  // status-query, delivered to the orchestrator registry. When omitted the
  // POST /intents route is not registered.
  intents?: {
    dispatch: (intent: DispatchIntent) => Promise<IntentAck>;
    query: (intent: StatusQueryIntent) => Promise<StatusReport>;
  };
  // Shared idempotency ledger for /intents and /actions (design 2.6). The
  // boot path supplies one so it survives app rebuilds.
  intentLedger?: IntentLedger;
  // Shared SSE broadcaster (createHubBroadcaster). The boot path supplies one
  // so an app rebuild neither orphans a permanently-subscribed broadcaster on
  // the bus nor resets the replay ring and id counter.
  sseBroadcaster?: SseBroadcaster;
  voiceGateway?: VoiceGateway;
  voice?: {
    enabled: boolean;
    pttKey: string;
    stt: "mock" | "http";
    tts: boolean;
  };
  intent?: {
    enabled: boolean;
    mock: boolean;
  };
  cursorWebhook?: {
    enabled: boolean;
    secret?: string;
  };
}

// One broadcaster per Hub process: each world event is ranked and encoded
// exactly once for every connected /stream client, gets a monotonic id, and
// lands in the bounded replay ring. The bus subscription is permanent (not
// attached per client) because Last-Event-ID resume only works if events that
// fired while no client was connected are still in the ring. Ids are seeded
// from the boot time so a Last-Event-ID from a previous run never aliases
// into this run's range.
export function createHubBroadcaster(
  deps: Pick<ServerDeps, "worldModel" | "bus" | "cap">,
): SseBroadcaster {
  const broadcaster = createSseBroadcaster({ epoch: Date.now() });
  deps.bus.on("world:changed", () =>
    broadcaster.publish("state", stateSnapshot(deps)),
  );

  return broadcaster;
}

export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  // Framework fallbacks speak the same problem+json contract as every
  // hand-written error body (docs/hub-api.md).
  app.notFound((c) => problem(c, { status: 404, title: "Not Found" }));
  app.onError((error, c) => {
    console.error(error);
    return problem(c, {
      status: 500,
      title: "Internal Server Error",
      detail: error instanceof Error ? error.message : "Internal Server Error",
    });
  });

  app.use(
    "*",
    cors({
      origin: (origin) =>
        origin === "tauri://localhost" ||
        origin.startsWith("http://localhost:") ||
        (deps.corsOrigin !== undefined && origin === deps.corsOrigin)
          ? origin
          : undefined,
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Aspex-Voice-Session",
        "X-Aspex-Voice-Generation",
      ],
      exposeHeaders: [IDEMPOTENCY_REPLAYED_HEADER],
    }),
  );

  if (deps.authToken !== undefined && deps.authToken !== "") {
    app.use("*", hubAuth(deps.authToken));
  }

  app.get("/health", (c) => c.json({ ok: true, version: deps.version }));
  app.get("/config", (c) =>
    c.json({
      voice: deps.voice ?? {
        enabled: false,
        pttKey: "Space",
        stt: "http",
        tts: false,
      },
      intentEnabled: deps.intent?.enabled === true,
      intent: {
        enabled: deps.intent?.enabled === true,
      },
    }),
  );

  registerVoiceRoutes(app, deps);
  registerCursorWebhookRoute(app, deps);

  app.get("/state", (c) => c.json(stateSnapshot(deps)));

  const broadcaster = deps.sseBroadcaster ?? createHubBroadcaster(deps);

  app.get("/stream", (c) => {
    const stream = createStateStream({
      snapshot: () => stateSnapshot(deps),
      broadcaster,
      lastEventId: parseLastEventId(c.req.header("last-event-id")),
    });

    return c.body(stream, 200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
  });

  app.post("/signals/:source", async (c) => {
    try {
      const source = c.req.param("source") as Source;
      const rawBody = await c.req.json();
      const body =
        source === "webhook" ? normalizeWebhookBody(rawBody) : rawBody;

      assertSignal(body);

      const signal = {
        ...body,
        source,
      };

      assertSignal(signal);

      if (isClaudeCodeHeartbeat(signal)) {
        deps.worldModel.applyHeartbeat(signal);
      } else {
        deps.worldModel.applySignal(signal);
      }

      return c.json({ accepted: true }, 202);
    } catch (error) {
      return problem(c, {
        status: 400,
        title: "Invalid Signal",
        detail: validationMessage(error),
      });
    }
  });

  const ledger = deps.intentLedger ?? new IntentLedger();

  app.post("/actions/:itemId/:actionId", async (c) => {
    const itemId = c.req.param("itemId");
    const actionId = c.req.param("actionId");
    let body: { confirmed?: boolean; intentId?: unknown; payload?: unknown };
    try {
      body = await readOptionalJson(c.req.raw);
    } catch (error) {
      return problem(c, {
        status: 400,
        title: "Invalid request body",
        detail: validationMessage(error),
      });
    }

    // Optional idempotency key (design 2.6 + IETF Idempotency-Key draft): a
    // retried consequential action returns the recorded ack instead of
    // running twice. The key arrives as the domain `intentId` in the body,
    // the `Idempotency-Key` header, or both - and both must agree.
    const keyOutcome = resolveIdempotencyKey(c, body.intentId);

    if ("response" in keyOutcome) {
      return keyOutcome.response;
    }

    const intentId = keyOutcome.intentId;

    if (
      intentId !== undefined &&
      body.payload !== undefined &&
      !isRecord(body.payload)
    ) {
      return problem(c, {
        status: 400,
        title: "Invalid request body",
        detail: "payload must be an object when intentId is set",
      });
    }

    const runAction = async (): Promise<LedgerEntry> => {
      const meta = deps.actionMeta(itemId, actionId);

      if (meta?.requiresConfirmation && body.confirmed !== true) {
        // Machine-readable bridge for the kept 409 gate: the client restates
        // the summary to the user and, on approval, re-POSTs `resend` to the
        // same URL (the payload it must send back, confirmed).
        return {
          status: 409,
          body: problemBody({
            status: 409,
            type: PROBLEM_TYPES.confirmationRequired,
            title: "Action requires confirmation",
            detail: `Action requires confirmation: ${confirmationSummary(meta.label ?? actionId, itemId)}`,
            extensions: {
              itemId,
              actionId,
              summary: confirmationSummary(meta.label ?? actionId, itemId),
              resend: {
                ...(isRecord(body.payload) ? { payload: body.payload } : {}),
                ...(intentId === undefined ? {} : { intentId }),
                confirmed: true,
              },
            },
          }),
        };
      }

      // The intentId rides inside the payload so the owning orchestrator can
      // reuse it as the delivery-inbox filename (end-to-end dedupe).
      const payload =
        intentId === undefined
          ? body.payload
          : { ...(isRecord(body.payload) ? body.payload : {}), intentId };
      const result = await deps.dispatchAction(itemId, actionId, payload);
      return { status: 200, body: result };
    };

    if (intentId === undefined) {
      return respondLedgerEntry(c, await runAction(), false);
    }

    const fingerprint = requestFingerprint({
      kind: "action",
      itemId,
      actionId,
      confirmed: body.confirmed === true,
      payload: body.payload ?? null,
    });
    const outcome = await ledger.execute(intentId, fingerprint, async () => {
      const entry = await runAction();
      const dispatched =
        entry.status === 200 && isRecord(entry.body) && entry.body.ok === true;
      return { entry, record: dispatched };
    });

    return respondLedgerResult(c, outcome, intentId);
  });

  if (deps.intents !== undefined) {
    registerIntentsRoute(app, deps.intents, ledger);
  }

  return app;
}

// POST /intents: the one new route of the orchestrator protocol (design 2.4)
// for the two verbs with no pre-existing item - dispatch and status-query.
// Item-scoped verbs stay on /actions and inherit the confirmation gate there.
function registerIntentsRoute(
  app: Hono,
  intents: NonNullable<ServerDeps["intents"]>,
  ledger: IntentLedger,
): void {
  app.post("/intents", async (c) => {
    let intent: DispatchIntent | StatusQueryIntent;
    try {
      const body = await c.req.json();
      assertDirectionIntent(body);
      intent = body;
    } catch (error) {
      return problem(c, {
        status: 400,
        title: "Invalid DirectionIntent",
        detail: validationMessage(error),
      });
    }

    // The body intentId is the domain id (it names the orchestrator inbox
    // file); an Idempotency-Key header is accepted but must agree with it.
    const keyOutcome = resolveIdempotencyKey(c, intent.intentId);

    if ("response" in keyOutcome) {
      return keyOutcome.response;
    }

    if (intent.verb === "status_query") {
      const report = await intents.query(intent);

      if (report.ok) {
        return c.json(report, 200);
      }

      return problem(c, {
        status: 404,
        title: "Status query unmatched",
        detail: report.text,
        extensions: { ok: false, text: report.text },
      });
    }

    const dispatch = intent;
    const fingerprint = requestFingerprint({
      kind: "dispatch",
      orchestrator: dispatch.orchestrator,
      project: dispatch.project ?? null,
      instruction: dispatch.instruction,
      confirmed: dispatch.confirmed === true,
    });
    const outcome = await ledger.execute(
      dispatch.intentId,
      fingerprint,
      async () => {
        // Same two-step confirm as consequential actions: dispatch spends real
        // compute, so an unconfirmed intent is refused and nothing is
        // delivered.
        if (dispatch.confirmed !== true) {
          return {
            entry: {
              status: 409,
              body: problemBody({
                status: 409,
                type: PROBLEM_TYPES.confirmationRequired,
                title: "Action requires confirmation",
                detail: `Dispatch requires confirmation: ${dispatch.instruction}`,
                extensions: {
                  verb: "dispatch",
                  intentId: dispatch.intentId,
                  orchestrator: dispatch.orchestrator,
                  summary: `Dispatch to ${dispatch.orchestrator}: ${dispatch.instruction}`,
                  resend: { ...dispatch, confirmed: true },
                },
              }),
            },
            record: false,
          };
        }

        const ack = await intents.dispatch(dispatch);
        return ack.ok
          ? { entry: { status: 202, body: ack }, record: true }
          : {
              entry: {
                status: 502,
                body: problemBody({
                  status: 502,
                  title: "Dispatch failed",
                  detail: ack.message ?? "Dispatch failed",
                  extensions: { ok: false },
                }),
              },
              record: false,
            };
      },
    );

    return respondLedgerResult(c, outcome, dispatch.intentId);
  });
}

// Reads and reconciles the two places an idempotency key may arrive (the
// domain intentId in the body and the IETF Idempotency-Key header). Returns
// the effective key, or the problem response that settles the request.
function resolveIdempotencyKey(
  c: Context,
  bodyIntentId: unknown,
): { intentId: string | undefined } | { response: Response } {
  const header = idempotencyKeyHeader(c);

  if (header !== undefined && !isValidIntentId(header)) {
    return {
      response: problem(c, {
        status: 400,
        title: "Invalid Idempotency-Key",
        detail:
          "Idempotency-Key must be 1-128 filename-safe characters ([A-Za-z0-9._-], no leading dot)",
      }),
    };
  }

  if (bodyIntentId !== undefined && !isValidIntentId(bodyIntentId)) {
    return {
      response: problem(c, {
        status: 400,
        title: "Invalid intentId",
      }),
    };
  }

  if (
    header !== undefined &&
    bodyIntentId !== undefined &&
    header !== bodyIntentId
  ) {
    return {
      response: problem(c, {
        status: 400,
        type: PROBLEM_TYPES.idempotencyKeyMismatch,
        title: "Idempotency-Key and intentId disagree",
        detail: `The Idempotency-Key header ("${header}") and the body intentId ("${bodyIntentId}") must carry the same value`,
        extensions: { idempotencyKey: header, intentId: bodyIntentId },
      }),
    };
  }

  return { intentId: bodyIntentId ?? header };
}

// The draft encodes the value as a quoted-string; Stripe-style clients send
// it bare. Accept both.
function idempotencyKeyHeader(c: Context): string | undefined {
  const raw = c.req.header("idempotency-key")?.trim();

  if (raw === undefined || raw === "") {
    return undefined;
  }

  const unquoted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;

  return unquoted === "" ? undefined : unquoted;
}

function respondLedgerResult(
  c: Context,
  result: LedgerResult,
  intentId: string,
): Response {
  if (result.kind === "mismatch") {
    return problem(c, {
      status: 422,
      type: PROBLEM_TYPES.sameKeyDifferentPayload,
      title: "Same idempotency key, different payload",
      detail: `Intent "${intentId}" was already used for a different request; retries must resend the identical payload`,
      extensions: { intentId },
    });
  }

  return respondLedgerEntry(c, result.entry, result.kind === "replayed");
}

function respondLedgerEntry(
  c: Context,
  entry: LedgerEntry,
  replayed: boolean,
): Response {
  const headers = replayed
    ? { [IDEMPOTENCY_REPLAYED_HEADER]: "true" }
    : undefined;

  if (isProblemBody(entry.body)) {
    return problemResponse(c, entry.body, headers);
  }

  return c.json(entry.body, entry.status as 200, headers);
}

function confirmationSummary(label: string, itemId: string): string {
  return `Confirm ${label} on ${itemId}`;
}

function parseLastEventId(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,15}$/.test(value.trim())) {
    return undefined;
  }

  return Number(value.trim());
}

function registerCursorWebhookRoute(app: Hono, deps: ServerDeps): void {
  if (deps.cursorWebhook?.enabled !== true) {
    return;
  }

  app.post("/webhooks/cursor", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header(CURSOR_SIGNATURE_HEADER);

    if (
      !verifyCursorSignature({
        secret: deps.cursorWebhook?.secret,
        rawBody,
        signature,
      })
    ) {
      return problem(c, { status: 401, title: "Invalid cursor signature" });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      return problem(c, {
        status: 400,
        title: "Invalid cursor webhook body",
        detail: validationMessage(error),
      });
    }

    const signal = mapCursorStatusChangeToSignal(body);

    if (signal === null) {
      return problem(c, { status: 400, title: "Invalid cursor webhook body" });
    }

    deps.worldModel.applySignal(
      signal as unknown as Parameters<typeof deps.worldModel.applySignal>[0],
    );

    return c.json({ accepted: true }, 202);
  });
}

function stateSnapshot(deps: Pick<ServerDeps, "worldModel" | "cap">) {
  return {
    apiVersion: HUB_API_VERSION,
    ...rank(deps.worldModel.snapshot(), deps.cap),
    generatedAt: new Date().toISOString(),
  };
}

async function readOptionalJson(
  request: Request,
): Promise<{ confirmed?: boolean; payload?: unknown }> {
  const text = await request.text();

  if (text.trim() === "") {
    return {};
  }

  const body = JSON.parse(text);
  return isRecord(body) ? body : {};
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid request";
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

function isClaudeCodeHeartbeat(signal: unknown): signal is {
  source: "claude-code";
  heartbeat: true;
} {
  return (
    isRecord(signal) &&
    signal.source === "claude-code" &&
    signal.heartbeat === true
  );
}
