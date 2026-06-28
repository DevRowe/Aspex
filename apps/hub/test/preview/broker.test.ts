import { describe, expect, test } from "bun:test";
import type { Preview, PreviewSpec } from "@aspex/schema";
import { createPreviewBroker } from "../../src/preview/broker";
import type {
  ExitInfo,
  PreviewEngine,
  PreviewHandle,
} from "../../src/preview/engine";

const baseSpec: PreviewSpec = {
  id: "app",
  name: "App",
  engine: "mock",
  image: "example/app:latest",
  port: 3000,
  trust: "trusted",
  limits: {},
};

const untrustedSpec: PreviewSpec = {
  ...baseSpec,
  id: "untrusted",
  name: "Untrusted",
  trust: "untrusted",
};

describe("createPreviewBroker", () => {
  test("boots a trusted spec through booting -> ready and returns snapshots", async () => {
    let nowMs = Date.parse("2026-06-28T00:00:00.000Z");
    const engine = new FakeEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
      now: () => nowMs,
    });

    const changes: Preview[] = [];
    broker.onChange((preview) => changes.push(preview));

    const booting = await broker.boot("app");
    const ready = await waitForPreview(
      broker,
      booting.previewId,
      (preview) => preview.state === "ready",
    );

    expect(engine.boots).toBe(1);
    expect(changes.map((preview) => preview.state)).toEqual([
      "booting",
      "ready",
    ]);
    expect(booting).toMatchObject({
      specId: "app",
      state: "booting",
      trust: "trusted",
      startedAt: "2026-06-28T00:00:00.000Z",
    });
    expect(ready).toMatchObject({
      specId: "app",
      state: "ready",
      trust: "trusted",
      url: "http://127.0.0.1:41001",
      startedAt: "2026-06-28T00:00:00.000Z",
      expiresAt: "2026-06-28T00:00:30.000Z",
    });

    ready.state = "crashed";
    expect(broker.get(ready.previewId)?.state).toBe("ready");

    const listed = broker.list();
    listed[0].state = "stopped";
    expect(broker.list()[0].state).toBe("ready");

    nowMs += 1;
  });

  test("rejects unknown specs clearly", async () => {
    const broker = createPreviewBroker({
      engine: new FakeEngine(),
      lookupSpec: () => undefined,
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    await expect(broker.boot("missing")).rejects.toThrow(
      "Unknown Preview spec: missing",
    );
  });

  test("rejects untrusted specs until the pixels lane exists", async () => {
    const broker = createPreviewBroker({
      engine: new FakeEngine(),
      lookupSpec: (specId) =>
        specId === untrustedSpec.id ? untrustedSpec : undefined,
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    await expect(broker.boot("untrusted")).rejects.toThrow(
      "pixels lane not yet available",
    );
  });

  test("rejects past the max concurrent cap and frees it after stop", async () => {
    const engine = new FakeEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const first = await broker.boot("app");

    await expect(broker.boot("app")).rejects.toThrow("too many previews open");

    await broker.stop(first.previewId);
    const second = await broker.boot("app");
    const ready = await waitForPreview(
      broker,
      second.previewId,
      (preview) => preview.state === "ready",
    );

    expect(second.state).toBe("booting");
    expect(ready.state).toBe("ready");
    expect(engine.boots).toBe(2);
  });

  test("counts booting previews against the max concurrent cap", async () => {
    const engine = new DeferredEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const firstBoot = broker.boot("app");
    await engine.waitForBoots(1);

    await expect(broker.boot("app")).rejects.toThrow("too many previews open");

    const booting = await firstBoot;
    engine.resolveNext();
    await waitForPreview(
      broker,
      booting.previewId,
      (preview) => preview.state === "ready",
    );
    expect(booting).toMatchObject({ state: "booting" });
    expect(engine.boots).toBe(1);
  });

  test("reaps expired ready previews using the injected clock", async () => {
    let nowMs = Date.parse("2026-06-28T00:00:00.000Z");
    const engine = new FakeEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) =>
        specId === baseSpec.id
          ? { ...baseSpec, limits: { idleTtlSec: 5 } }
          : undefined,
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
      now: () => nowMs,
    });

    const changes: Preview[] = [];
    broker.onChange((preview) => changes.push(preview));
    const booting = await broker.boot("app");
    const ready = await waitForPreview(
      broker,
      booting.previewId,
      (preview) => preview.state === "ready",
    );

    nowMs = Date.parse("2026-06-28T00:00:05.000Z");
    expect(
      broker.list().find((p) => p.previewId === ready.previewId)?.state,
    ).toBe("stopped");

    expect(engine.stops).toBe(1);
    expect(changes.map((preview) => preview.state)).toEqual([
      "booting",
      "ready",
      "stopped",
    ]);
    const next = await broker.boot("app");
    await waitForPreview(
      broker,
      next.previewId,
      (preview) => preview.state === "ready",
    );
    expect(next).toMatchObject({ state: "booting" });
  });

  test("stop during boot keeps the preview stopped and reaps the eventual handle", async () => {
    const engine = new DeferredEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const boot = broker.boot("app");
    await engine.waitForBoots(1);
    const booting = await boot;

    await broker.stop(booting.previewId);
    engine.resolveNext();

    expect(broker.get(booting.previewId)).toMatchObject({ state: "stopped" });
    await waitFor(() => engine.stops === 1);
    expect(engine.stops).toBe(1);

    const nextBoot = await broker.boot("app");
    await engine.waitForBoots(2);
    engine.resolveNext();
    const ready = await waitForPreview(
      broker,
      nextBoot.previewId,
      (preview) => preview.state === "ready",
    );
    expect(nextBoot).toMatchObject({ state: "booting" });
    expect(ready).toMatchObject({ state: "ready" });
  });

  test("marks unexpected engine exit as crashed without restarting", async () => {
    const engine = new FakeEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const changes: Preview[] = [];
    broker.onChange((preview) => changes.push(preview));
    const booting = await broker.boot("app");
    const ready = await waitForPreview(
      broker,
      booting.previewId,
      (preview) => preview.state === "ready",
    );

    engine.exitLatest({ code: 137, message: "container exited" });

    expect(broker.get(ready.previewId)).toMatchObject({
      state: "crashed",
      message: "container exited",
    });
    expect(engine.boots).toBe(1);
    expect(changes.map((preview) => preview.state)).toEqual([
      "booting",
      "ready",
      "crashed",
    ]);

    const next = await broker.boot("app");
    const nextReady = await waitForPreview(
      broker,
      next.previewId,
      (preview) => preview.state === "ready",
    );
    expect(next.state).toBe("booting");
    expect(nextReady.state).toBe("ready");
    expect(engine.boots).toBe(2);
  });

  test("shutdown stops all live previews best-effort and clears the cap", async () => {
    const engine = new FakeEngine();
    const specs = new Map(
      ["one", "two"].map((id) => [id, { ...baseSpec, id }]),
    );
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => specs.get(specId),
      config: { maxConcurrent: 2, defaultIdleTtlSec: 30 },
    });

    const one = await broker.boot("one");
    const two = await broker.boot("two");
    await waitForPreview(
      broker,
      one.previewId,
      (preview) => preview.state === "ready",
    );
    await waitForPreview(
      broker,
      two.previewId,
      (preview) => preview.state === "ready",
    );
    await broker.shutdown();

    expect(engine.stops).toBe(2);
    expect(broker.list().map((preview) => preview.state)).toEqual([
      "stopped",
      "stopped",
    ]);
    const next = await broker.boot("one");
    const ready = await waitForPreview(
      broker,
      next.previewId,
      (preview) => preview.state === "ready",
    );
    expect(next).toMatchObject({ state: "booting" });
    expect(ready).toMatchObject({ state: "ready" });
  });

  test("shutdown waits for in-flight boots and stops their eventual handles", async () => {
    const engine = new DeferredEngine();
    const broker = createPreviewBroker({
      engine,
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const booting = await broker.boot("app");
    await engine.waitForBoots(1);
    const shutdown = broker.shutdown();

    engine.resolveNext();
    await shutdown;

    expect(broker.get(booting.previewId)).toMatchObject({ state: "stopped" });
    expect(engine.stops).toBe(1);

    const nextBoot = await broker.boot("app");
    await engine.waitForBoots(2);
    engine.resolveNext();
    const ready = await waitForPreview(
      broker,
      nextBoot.previewId,
      (preview) => preview.state === "ready",
    );
    expect(nextBoot).toMatchObject({ state: "booting" });
    expect(ready).toMatchObject({ state: "ready" });
  });

  test("onChange fires for every transition and unsubscribe removes listener", async () => {
    const broker = createPreviewBroker({
      engine: new FakeEngine(),
      lookupSpec: (specId) => (specId === baseSpec.id ? baseSpec : undefined),
      config: { maxConcurrent: 1, defaultIdleTtlSec: 30 },
    });

    const changes: Preview[] = [];
    const unsubscribe = broker.onChange((preview) => changes.push(preview));
    const booting = await broker.boot("app");
    await waitForPreview(
      broker,
      booting.previewId,
      (preview) => preview.state === "ready",
    );

    unsubscribe();
    await broker.stop(booting.previewId);

    expect(changes.map((preview) => preview.state)).toEqual([
      "booting",
      "ready",
    ]);
  });
});

async function waitForPreview(
  broker: ReturnType<typeof createPreviewBroker>,
  previewId: string,
  predicate: (preview: Preview) => boolean,
): Promise<Preview> {
  let last: Preview | undefined;

  await waitFor(() => {
    last = broker.get(previewId);
    return last !== undefined && predicate(last);
  });

  if (last === undefined) {
    throw new Error(`Preview not found: ${previewId}`);
  }

  return last;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(0);
  }

  throw new Error("Timed out waiting for condition");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeEngine implements PreviewEngine {
  kind = "mock" as const;
  boots = 0;
  stops = 0;
  handles: FakeHandle[] = [];

  async available(): Promise<boolean> {
    return true;
  }

  async boot(_spec: PreviewSpec): Promise<PreviewHandle> {
    this.boots += 1;
    const handle = new FakeHandle(
      `http://127.0.0.1:${41000 + this.boots}`,
      () => {
        this.stops += 1;
      },
    );
    this.handles.push(handle);
    return handle;
  }

  exitLatest(info: ExitInfo): void {
    const handle = [...this.handles].reverse().find((candidate) => {
      return !candidate.stopped && !candidate.exited;
    });
    handle?.exit(info);
  }
}

class FakeHandle implements PreviewHandle {
  stopped = false;
  exited = false;
  private readonly callbacks = new Set<(info: ExitInfo) => void>();

  constructor(
    readonly url: string,
    private readonly onStop: () => void,
  ) {}

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.callbacks.clear();
    this.onStop();
  }

  onExit(cb: (info: ExitInfo) => void): void {
    if (!this.stopped && !this.exited) {
      this.callbacks.add(cb);
    }
  }

  exit(info: ExitInfo): void {
    if (this.stopped || this.exited) {
      return;
    }
    this.exited = true;
    const callbacks = [...this.callbacks];
    this.callbacks.clear();
    for (const cb of callbacks) {
      cb(info);
    }
  }
}

class DeferredEngine extends FakeEngine {
  private readonly pending: Array<(handle: PreviewHandle) => void> = [];
  private readonly bootWaiters: Array<() => void> = [];

  override async boot(_spec: PreviewSpec): Promise<PreviewHandle> {
    this.boots += 1;
    const handle = new FakeHandle(
      `http://127.0.0.1:${41000 + this.boots}`,
      () => {
        this.stops += 1;
      },
    );
    this.handles.push(handle);
    this.notifyBootWaiters();

    return new Promise((resolve) => {
      this.pending.push(resolve);
    });
  }

  async waitForBoots(count: number): Promise<void> {
    if (this.boots >= count) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.bootWaiters.push(resolve);
    });
  }

  resolveNext(): void {
    const resolve = this.pending.shift();
    const handle = this.handles[this.handles.length - 1];
    if (resolve === undefined || handle === undefined) {
      throw new Error("No deferred boot is pending");
    }
    resolve(handle);
  }

  private notifyBootWaiters(): void {
    for (let index = this.bootWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.bootWaiters[index];
      if (waiter !== undefined) {
        this.bootWaiters.splice(index, 1);
        waiter();
      }
    }
  }
}
