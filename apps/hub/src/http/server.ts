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
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bus } from "../bus";
import { rank } from "../engine/attention";
import type { PreviewBroker } from "../preview/broker";
import type { PreviewRegistry } from "../preview/registry";
import type { VoiceGateway } from "../voice/gateway";
import type { WorldModel } from "../world/worldModel";
import { hubAuth } from "./auth";
import { IntentLedger } from "./intentLedger";
import { registerPreviewRoutes, subscribePreviewEvents } from "./preview";
import { createStateStream } from "./sse";
import { registerVoiceRoutes } from "./voice";

export interface ServerDeps {
  worldModel: WorldModel;
  bus: Bus;
  cap: number;
  version: string;
  // Local bearer token required on every endpoint (ADR-0023). When omitted the
  // app is unauthenticated; the Hub boot path always supplies one.
  authToken?: string;
  // One extra exact origin allowed by CORS (the HL2 Edge client), alongside
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
  ) => { requiresConfirmation: boolean } | null;
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
  previews?: {
    enabled: boolean;
    broker?: PreviewBroker;
    registry?: PreviewRegistry;
  };
}

export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) =>
        origin === "tauri://localhost" ||
        origin.startsWith("http://localhost:") ||
        (deps.corsOrigin !== undefined && origin === deps.corsOrigin)
          ? origin
          : undefined,
      allowHeaders: ["Authorization", "Content-Type", "X-Aspex-Voice-Session"],
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
      previews: {
        enabled:
          deps.previews?.enabled === true &&
          deps.previews.broker !== undefined &&
          deps.previews.registry !== undefined,
      },
      intentEnabled: deps.intent?.enabled === true,
      intent: {
        enabled: deps.intent?.enabled === true,
      },
    }),
  );

  registerVoiceRoutes(app, deps);
  registerCursorWebhookRoute(app, deps);
  const previewDeps =
    deps.previews?.enabled === true &&
    deps.previews.broker !== undefined &&
    deps.previews.registry !== undefined
      ? {
          broker: deps.previews.broker,
          registry: deps.previews.registry,
          bus: deps.bus,
        }
      : undefined;

  if (previewDeps !== undefined) {
    registerPreviewRoutes(app, previewDeps);
    subscribePreviewEvents(previewDeps);
  }

  app.get("/state", (c) => c.json(stateSnapshot(deps)));

  app.get("/stream", (c) => {
    const stream = createStateStream({
      snapshot: () => stateSnapshot(deps),
      subscribe: (sendState) => {
        deps.bus.on("world:changed", sendState);
        return () => deps.bus.off("world:changed", sendState);
      },
      events:
        previewDeps === undefined
          ? []
          : [
              {
                event: "preview",
                subscribe: (sendPreview) => {
                  deps.bus.on("preview", sendPreview);
                  return () => deps.bus.off("preview", sendPreview);
                },
              },
            ],
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
      return c.json({ message: validationMessage(error) }, 400);
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
      return c.json({ message: validationMessage(error) }, 400);
    }

    // Optional idempotency key (design 2.6): a retried consequential action
    // returns the recorded ack instead of running twice.
    const intentId = body.intentId;

    if (intentId !== undefined && !isValidIntentId(intentId)) {
      return c.json({ message: "Invalid intentId" }, 400);
    }

    if (
      intentId !== undefined &&
      body.payload !== undefined &&
      !isRecord(body.payload)
    ) {
      return c.json(
        { message: "payload must be an object when intentId is set" },
        400,
      );
    }

    if (intentId !== undefined) {
      const seen = ledger.get(intentId);

      if (seen !== null) {
        return c.json(seen.body, seen.status as 200);
      }
    }

    const meta = deps.actionMeta(itemId, actionId);

    if (meta?.requiresConfirmation && body.confirmed !== true) {
      return c.json({ message: "Action requires confirmation" }, 409);
    }

    // The intentId rides inside the payload so the owning orchestrator can
    // reuse it as the delivery-inbox filename (end-to-end dedupe).
    const payload =
      intentId === undefined
        ? body.payload
        : { ...(isRecord(body.payload) ? body.payload : {}), intentId };
    const result = await deps.dispatchAction(itemId, actionId, payload);

    if (intentId !== undefined && result.ok) {
      ledger.record(intentId, { status: 200, body: result });
    }

    return c.json(result);
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
      return c.json({ message: validationMessage(error) }, 400);
    }

    if (intent.verb === "status_query") {
      const report = await intents.query(intent);
      return c.json(report, report.ok ? 200 : 404);
    }

    const seen = ledger.get(intent.intentId);

    if (seen !== null) {
      return c.json(seen.body, seen.status as 202);
    }

    // Same two-step confirm as consequential actions: dispatch spends real
    // compute, so an unconfirmed intent is refused and nothing is delivered.
    if (intent.confirmed !== true) {
      return c.json({ message: "Action requires confirmation" }, 409);
    }

    const ack = await intents.dispatch(intent);

    if (ack.ok) {
      ledger.record(intent.intentId, { status: 202, body: ack });
      return c.json(ack, 202);
    }

    return c.json(ack, 502);
  });
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
      return c.json({ message: "Invalid cursor signature" }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      return c.json({ message: validationMessage(error) }, 400);
    }

    const signal = mapCursorStatusChangeToSignal(body);

    if (signal === null) {
      return c.json({ message: "Invalid cursor webhook body" }, 400);
    }

    deps.worldModel.applySignal(
      signal as unknown as Parameters<typeof deps.worldModel.applySignal>[0],
    );

    return c.json({ accepted: true }, 202);
  });
}

function stateSnapshot(deps: ServerDeps) {
  return {
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
