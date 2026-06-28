import { describe, expect, test } from "bun:test";
import type { ActionResult, Preview, PreviewSpec } from "@aspex/schema";
import { Bus } from "../../src/bus";
import { type ServerDeps, buildApp } from "../../src/http/server";
import type { PreviewBroker } from "../../src/preview/broker";
import type { PreviewRegistry } from "../../src/preview/registry";

const trustedSpec: PreviewSpec = {
  id: "web",
  name: "Web",
  engine: "mock",
  image: "example/web:latest",
  port: 3000,
  trust: "trusted",
  itemId: "github:pr:owner/repo#42",
  limits: {},
};

const untrustedSpec: PreviewSpec = {
  ...trustedSpec,
  id: "untrusted",
  name: "Untrusted",
  trust: "untrusted",
};

const readyPreview: Preview = {
  previewId: "preview-1",
  specId: "web",
  state: "ready",
  trust: "trusted",
  url: "http://127.0.0.1:41001",
  startedAt: "2026-06-28T00:00:00.000Z",
  expiresAt: "2026-06-28T00:05:00.000Z",
};

const bootingPreview: Preview = {
  previewId: "preview-1",
  specId: "web",
  state: "booting",
  trust: "trusted",
  startedAt: "2026-06-28T00:00:00.000Z",
};

describe("hub preview HTTP routes", () => {
  test("GET /previews/specs returns registry specs", async () => {
    const { app } = openServer({
      registry: new FakeRegistry([trustedSpec, untrustedSpec]),
    });

    const response = await app.fetch(
      new Request("http://hub.test/previews/specs"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([trustedSpec, untrustedSpec]);
  });

  test("POST /previews boots a spec and returns 201", async () => {
    const broker = new FakeBroker();
    broker.bootResults.set("web", bootingPreview);
    const { app } = openServer({ broker });

    const response = await app.fetch(
      jsonRequest("http://hub.test/previews", { specId: "web" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(bootingPreview);
    expect(broker.bootCalls).toEqual(["web"]);
  });

  test("POST /previews maps broker failures to card 41 statuses", async () => {
    const broker = new FakeBroker();
    broker.bootErrors.set(
      "missing",
      new Error("Unknown Preview spec: missing"),
    );
    broker.bootErrors.set(
      "untrusted",
      new Error("Untrusted Preview spec: pixels lane not yet available"),
    );
    broker.bootErrors.set("full", new Error("too many previews open"));
    const { app } = openServer({ broker });

    const missing = await app.fetch(
      jsonRequest("http://hub.test/previews", { specId: "missing" }),
    );
    const untrusted = await app.fetch(
      jsonRequest("http://hub.test/previews", { specId: "untrusted" }),
    );
    const full = await app.fetch(
      jsonRequest("http://hub.test/previews", { specId: "full" }),
    );

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      message: "Unknown Preview spec: missing",
    });
    expect(untrusted.status).toBe(403);
    expect(await untrusted.json()).toEqual({
      message: "Untrusted Preview spec: pixels lane not yet available",
    });
    expect(full.status).toBe(429);
    expect(await full.json()).toEqual({ message: "too many previews open" });
  });

  test("POST /previews rejects malformed JSON and missing specId", async () => {
    const { app } = openServer();

    const malformed = await app.fetch(
      new Request("http://hub.test/previews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    const missingSpecId = await app.fetch(
      jsonRequest("http://hub.test/previews", { id: "web" }),
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toHaveProperty("message");
    expect(missingSpecId.status).toBe(400);
    expect(await missingSpecId.json()).toEqual({
      message: "Expected JSON body with specId",
    });
  });

  test("GET /previews returns live previews", async () => {
    const broker = new FakeBroker([readyPreview]);
    const { app } = openServer({ broker });

    const response = await app.fetch(new Request("http://hub.test/previews"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([readyPreview]);
  });

  test("GET /previews/:id returns a preview or 404", async () => {
    const broker = new FakeBroker([readyPreview]);
    const { app } = openServer({ broker });

    const found = await app.fetch(
      new Request("http://hub.test/previews/preview-1"),
    );
    const missing = await app.fetch(
      new Request("http://hub.test/previews/missing"),
    );

    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(readyPreview);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "Preview not found" });
  });

  test("DELETE /previews/:id stops a preview or returns 404", async () => {
    const broker = new FakeBroker([readyPreview]);
    const { app } = openServer({ broker });

    const stopped = await app.fetch(
      new Request("http://hub.test/previews/preview-1", { method: "DELETE" }),
    );
    const missing = await app.fetch(
      new Request("http://hub.test/previews/missing", { method: "DELETE" }),
    );

    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe("");
    expect(broker.stopCalls).toEqual(["preview-1"]);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "Preview not found" });
  });

  test("DELETE /previews/:id maps stop failures to JSON errors", async () => {
    const broker = new FakeBroker([readyPreview]);
    broker.stopErrors.set(
      "preview-1",
      new Error("Failed to stop Preview process"),
    );
    const { app } = openServer({ broker });

    const response = await app.fetch(
      new Request("http://hub.test/previews/preview-1", { method: "DELETE" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Failed to stop Preview process",
    });
  });

  test("DELETE /previews/:id maps stop races for unknown previews to 404", async () => {
    const broker = new FakeBroker([readyPreview]);
    broker.stopErrors.set("preview-1", new Error("Unknown Preview: preview-1"));
    const { app } = openServer({ broker });

    const response = await app.fetch(
      new Request("http://hub.test/previews/preview-1", { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      message: "Unknown Preview: preview-1",
    });
  });

  test("disabled previews are not mounted and do not subscribe to broker changes", async () => {
    const broker = new FakeBroker([readyPreview]);
    const { app } = openServer({ broker, previewsEnabled: false });

    const response = await app.fetch(
      new Request("http://hub.test/previews/specs"),
    );

    expect(response.status).toBe(404);
    expect(broker.listenerCount).toBe(0);
  });

  test("enabled previews without required deps are not mounted", async () => {
    const app = buildApp({
      worldModel: { snapshot: () => [] } as unknown as ServerDeps["worldModel"],
      bus: new Bus(),
      cap: 7,
      version: "test",
      actionMeta: () => ({ requiresConfirmation: false }),
      dispatchAction: async (): Promise<ActionResult> => ({ ok: true }),
      previews: {
        enabled: true,
      },
    });

    const response = await app.fetch(
      new Request("http://hub.test/previews/specs"),
    );

    expect(response.status).toBe(404);
  });

  test("GET /stream publishes preview events on the existing SSE connection", async () => {
    const broker = new FakeBroker([readyPreview]);
    const { app } = openServer({ broker });
    const response = await app.fetch(new Request("http://hub.test/stream"));
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(reader).toBeDefined();

    const initial = await reader?.read();
    broker.emitChange(readyPreview);
    const preview = await reader?.read();
    await reader?.cancel();

    expect(decode(initial?.value)).toContain("event: state\ndata:");
    expect(decode(preview?.value)).toContain("event: preview\ndata:");
    expect(decode(preview?.value)).toContain('"previewId":"preview-1"');
  });
});

function openServer(
  options: {
    broker?: FakeBroker;
    registry?: FakeRegistry;
    previewsEnabled?: boolean;
  } = {},
) {
  const broker = options.broker ?? new FakeBroker([readyPreview]);
  const registry = options.registry ?? new FakeRegistry([trustedSpec]);
  const previewsEnabled = options.previewsEnabled ?? true;
  const app = buildApp({
    worldModel: { snapshot: () => [] } as unknown as ServerDeps["worldModel"],
    bus: new Bus(),
    cap: 7,
    version: "test",
    actionMeta: () => ({ requiresConfirmation: false }),
    dispatchAction: async (): Promise<ActionResult> => ({ ok: true }),
    previews: {
      enabled: previewsEnabled,
      broker,
      registry,
    },
  });

  return { app, broker, registry };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function decode(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}

class FakeRegistry implements PreviewRegistry {
  constructor(private readonly specs: PreviewSpec[]) {}

  list(): PreviewSpec[] {
    return [...this.specs];
  }

  get(specId: string): PreviewSpec | undefined {
    return this.specs.find((spec) => spec.id === specId);
  }

  byItem(itemId: string): PreviewSpec[] {
    return this.specs.filter((spec) => spec.itemId === itemId);
  }
}

class FakeBroker implements PreviewBroker {
  readonly bootResults = new Map<string, Preview>();
  readonly bootErrors = new Map<string, Error>();
  readonly stopErrors = new Map<string, Error>();
  readonly bootCalls: string[] = [];
  readonly stopCalls: string[] = [];
  private readonly previews = new Map<string, Preview>();
  private readonly listeners = new Set<(p: Preview) => void>();

  constructor(previews: Preview[] = []) {
    for (const preview of previews) {
      this.previews.set(preview.previewId, preview);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  async boot(specId: string): Promise<Preview> {
    this.bootCalls.push(specId);

    const error = this.bootErrors.get(specId);
    if (error !== undefined) {
      throw error;
    }

    const preview = this.bootResults.get(specId);
    if (preview === undefined) {
      throw new Error(`Unknown Preview spec: ${specId}`);
    }

    this.previews.set(preview.previewId, preview);
    return preview;
  }

  async stop(previewId: string): Promise<void> {
    this.stopCalls.push(previewId);

    const error = this.stopErrors.get(previewId);
    if (error !== undefined) {
      throw error;
    }
  }

  get(previewId: string): Preview | undefined {
    return this.previews.get(previewId);
  }

  list(): Preview[] {
    return [...this.previews.values()];
  }

  async sweep(): Promise<void> {}

  async shutdown(): Promise<void> {}

  onChange(cb: (p: Preview) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emitChange(preview: Preview): void {
    for (const listener of this.listeners) {
      listener(preview);
    }
  }
}
