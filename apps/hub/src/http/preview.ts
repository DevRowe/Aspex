import { Hono } from "hono";
import type { Bus } from "../bus";
import type { PreviewBroker } from "../preview/broker";
import type { PreviewRegistry } from "../preview/registry";

export interface PreviewHttpDeps {
  broker: PreviewBroker;
  registry: PreviewRegistry;
  bus: Bus;
}

export function registerPreviewRoutes(app: Hono, deps: PreviewHttpDeps): void {
  const previews = new Hono();

  previews.get("/specs", (c) => c.json(deps.registry.list()));

  previews.post("/", async (c) => {
    let body: unknown;

    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ message: validationMessage(error) }, 400);
    }

    if (!isRecord(body) || typeof body.specId !== "string") {
      return c.json({ message: "Expected JSON body with specId" }, 400);
    }

    try {
      const preview = await deps.broker.boot(body.specId);
      return c.json(preview, 201);
    } catch (error) {
      const mapped = mapBrokerError(error);
      return c.json({ message: mapped.message }, mapped.status);
    }
  });

  previews.get("/", (c) => c.json(deps.broker.list()));

  previews.get("/:id", (c) => {
    const preview = deps.broker.get(c.req.param("id"));

    if (preview === undefined) {
      return c.json({ message: "Preview not found" }, 404);
    }

    return c.json(preview);
  });

  previews.delete("/:id", async (c) => {
    const previewId = c.req.param("id");

    if (deps.broker.get(previewId) === undefined) {
      return c.json({ message: "Preview not found" }, 404);
    }

    try {
      await deps.broker.stop(previewId);
      return c.body(null, 204);
    } catch (error) {
      const mapped = mapStopError(error);
      return c.json({ message: mapped.message }, mapped.status);
    }
  });

  app.route("/previews", previews);
}

export function subscribePreviewEvents(deps: PreviewHttpDeps): () => void {
  return deps.broker.onChange((preview) => deps.bus.emit("preview", preview));
}

function mapBrokerError(error: unknown): {
  status: 403 | 404 | 429 | 500;
  message: string;
} {
  const message = validationMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("unknown preview spec")) {
    return { status: 404, message };
  }

  if (
    normalized.includes("untrusted") ||
    normalized.includes("pixels lane not yet available")
  ) {
    return { status: 403, message };
  }

  if (normalized.includes("too many previews open")) {
    return { status: 429, message };
  }

  return { status: 500, message };
}

function mapStopError(error: unknown): {
  status: 404 | 500;
  message: string;
} {
  const message = validationMessage(error);

  if (message.toLowerCase().includes("unknown preview")) {
    return { status: 404, message };
  }

  return { status: 500, message };
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid request";
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
