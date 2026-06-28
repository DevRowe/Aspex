import { describe, expect, test } from "bun:test";
import type { PreviewSpec } from "@aspex/schema";
import { buildHub } from "../src/boot";
import { DEFAULT_CONFIG } from "../src/config";
import type {
  ExitInfo,
  PreviewEngine,
  PreviewHandle,
} from "../src/preview/engine";

describe("hub boot", () => {
  test("registers the mock adapter only when mock mode is enabled", async () => {
    const normalHub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });
    const mockHub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      mock: true,
    });

    try {
      await normalHub.start();
      await mockHub.start();

      await expect(
        normalHub.registry.dispatchAction(
          "github:pr:brocorp/aspex#101",
          "approve",
        ),
      ).resolves.toEqual({ ok: false, message: "No adapter for item source" });
      await expect(
        mockHub.registry.dispatchAction(
          "github:pr:brocorp/aspex#101",
          "approve",
        ),
      ).resolves.toEqual({ ok: true, message: "mock action" });
    } finally {
      await normalHub.stop();
      await mockHub.stop();
    }
  });

  test("does not mount preview routes when previews are disabled", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await hub.start();

      const config = await hub.app.fetch(new Request("http://hub.test/config"));
      const specs = await hub.app.fetch(
        new Request("http://hub.test/previews/specs"),
      );

      expect(await config.json()).toMatchObject({
        previews: { enabled: false },
      });
      expect(specs.status).toBe(404);
    } finally {
      await hub.stop();
    }
  });

  test("mounts preview routes, sweeps, and shuts down broker when mock engine is available", async () => {
    const engine = new FakePreviewEngine(true);
    const hub = buildHub(
      {
        ...DEFAULT_CONFIG,
        dbPath: ":memory:",
        previews: {
          enabled: true,
          engine: "mock",
          maxConcurrent: 1,
          limits: { cpus: "1", memory: "512m", idleTtlSec: 60 },
          specs: [previewSpec],
        },
      },
      { previewEngineFactory: () => engine },
    );

    try {
      await hub.start();

      const config = await hub.app.fetch(new Request("http://hub.test/config"));
      const specs = await hub.app.fetch(
        new Request("http://hub.test/previews/specs"),
      );
      const booted = await hub.app.fetch(
        new Request("http://hub.test/previews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ specId: "web" }),
        }),
      );

      expect(engine.sweepCalls).toBe(1);
      expect(await config.json()).toMatchObject({
        previews: { enabled: true },
      });
      expect(specs.status).toBe(200);
      expect(await specs.json()).toEqual([previewSpec]);
      expect(booted.status).toBe(201);
    } finally {
      await hub.stop();
    }

    expect(engine.stopCalls).toBe(1);
  });

  test("leaves preview routes unmounted when enabled engine is unavailable", async () => {
    const warnings: string[] = [];
    const engine = new FakePreviewEngine(false);
    const hub = buildHub(
      {
        ...DEFAULT_CONFIG,
        dbPath: ":memory:",
        previews: {
          enabled: true,
          engine: "mock",
          maxConcurrent: 1,
          limits: { cpus: "1", memory: "512m", idleTtlSec: 60 },
          specs: [previewSpec],
        },
      },
      {
        previewEngineFactory: () => engine,
        log: { warn: (message) => warnings.push(message) },
      },
    );

    try {
      await hub.start();

      const config = await hub.app.fetch(new Request("http://hub.test/config"));
      const specs = await hub.app.fetch(
        new Request("http://hub.test/previews/specs"),
      );

      expect(await config.json()).toMatchObject({
        previews: { enabled: false },
      });
      expect(specs.status).toBe(404);
      expect(engine.sweepCalls).toBe(0);
      expect(warnings).toEqual([
        "previews enabled but mock engine unavailable; Preview Deck routes disabled",
      ]);
    } finally {
      await hub.stop();
    }
  });
});

const previewSpec: PreviewSpec = {
  id: "web",
  name: "Web",
  engine: "mock",
  image: "example/web:latest",
  port: 3000,
  trust: "trusted",
  limits: {},
};

class FakePreviewEngine implements PreviewEngine {
  readonly kind = "mock";
  sweepCalls = 0;
  stopCalls = 0;

  constructor(private readonly isAvailable: boolean) {}

  async available(): Promise<boolean> {
    return this.isAvailable;
  }

  async boot(_spec: PreviewSpec): Promise<PreviewHandle> {
    return {
      url: "http://127.0.0.1:41999",
      stop: async () => {
        this.stopCalls += 1;
      },
      onExit: (_cb: (info: ExitInfo) => void) => {},
    };
  }

  async sweep(): Promise<void> {
    this.sweepCalls += 1;
  }
}
