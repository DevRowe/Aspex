import { normalizeWebhookBody } from "@aspex/adapter-webhook";
import type { ActionResult, Source } from "@aspex/schema";
import { assertSignal } from "@aspex/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bus } from "../bus";
import { rank } from "../engine/attention";
import type { WorldModel } from "../world/worldModel";
import { createStateStream } from "./sse";

export interface ServerDeps {
  worldModel: WorldModel;
  bus: Bus;
  cap: number;
  version: string;
  dispatchAction: (
    itemId: string,
    actionId: string,
    payload?: unknown,
  ) => Promise<ActionResult>;
  actionMeta: (
    itemId: string,
    actionId: string,
  ) => { requiresConfirmation: boolean } | null;
}

export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) =>
        origin === "tauri://localhost" || origin.startsWith("http://localhost:")
          ? origin
          : undefined,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, version: deps.version }));

  app.get("/state", (c) => c.json(stateSnapshot(deps)));

  app.get("/stream", (c) => {
    const stream = createStateStream({
      snapshot: () => stateSnapshot(deps),
      subscribe: (sendState) => {
        deps.bus.on("world:changed", sendState);
        return () => deps.bus.off("world:changed", sendState);
      },
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

  app.post("/actions/:itemId/:actionId", async (c) => {
    const itemId = c.req.param("itemId");
    const actionId = c.req.param("actionId");
    let body: { confirmed?: boolean; payload?: unknown };
    try {
      body = await readOptionalJson(c.req.raw);
    } catch (error) {
      return c.json({ message: validationMessage(error) }, 400);
    }
    const meta = deps.actionMeta(itemId, actionId);

    if (meta?.requiresConfirmation && body.confirmed !== true) {
      return c.json({ message: "Action requires confirmation" }, 409);
    }

    const result = await deps.dispatchAction(itemId, actionId, body.payload);
    return c.json(result);
  });

  return app;
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
