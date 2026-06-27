import { describe, expect, test } from "bun:test";
import type { AdapterContext, Signal } from "@aspex/schema";
import { MockAdapter, type MockScriptEntry } from "../src";

class FakeClock {
  private nowMs = 0;
  private nextId = 1;
  private timers: Array<{ id: number; atMs: number; fn: () => void }> = [];

  setTimeout = (fn: () => void, delayMs: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, atMs: this.nowMs + delayMs, fn });

    return id;
  };

  clearTimeout = (timer: number): void => {
    this.timers = this.timers.filter(({ id }) => id !== timer);
  };

  advanceTo(ms: number): void {
    while (true) {
      const next = this.timers
        .filter((timer) => timer.atMs <= ms)
        .toSorted((a, b) => a.atMs - b.atMs || a.id - b.id)[0];

      if (next === undefined) {
        break;
      }

      this.timers = this.timers.filter(({ id }) => id !== next.id);
      this.nowMs = next.atMs;
      next.fn();
    }

    this.nowMs = ms;
  }

  pendingCount(): number {
    return this.timers.length;
  }
}

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "github:pr:o/r#1",
    source: "github",
    project: "o/r",
    state: "needs_review",
    reason: "review_requested",
    attentionRequired: true,
    summary: "Review requested",
    actions: [
      {
        id: "approve",
        label: "Approve",
        risk: "safe",
        requiresConfirmation: false,
      },
    ],
    ...overrides,
  };
}

function context(): {
  ctx: AdapterContext;
  emitted: Signal[];
  heartbeats: string[];
  logs: string[];
} {
  const emitted: Signal[] = [];
  const heartbeats: string[] = [];
  const logs: string[] = [];

  return {
    ctx: {
      emit: (item) => emitted.push(item),
      heartbeat: (source) => heartbeats.push(source),
      log: (msg) => logs.push(msg),
    },
    emitted,
    heartbeats,
    logs,
  };
}

describe("MockAdapter", () => {
  test("default script covers the required demo cases", async () => {
    const entries = await loadDemoScript();
    const signals = entries.map((entry) => entry.signal);
    const byId = new Map(signals.map((entry) => [entry.id, entry]));

    expect(entries).toHaveLength(8);
    expect(new Set(signals.map((entry) => entry.id)).size).toBe(7);
    expect(byId.get("github:pr:brocorp/aspex#101")).toMatchObject({
      source: "github",
      state: "needs_review",
      reason: "review_requested",
      attentionRequired: true,
    });
    expect(
      byId
        .get("github:pr:brocorp/aspex#101")
        ?.actions?.map((entry) => entry.id),
    ).toEqual(["approve", "comment"]);

    const failingCiSignals = signals.filter(
      (entry) => entry.id === "github:pr:brocorp/aspex#102",
    );
    expect(failingCiSignals).toHaveLength(1);
    expect(failingCiSignals[0]).toMatchObject({
      source: "github",
      state: "needs_review",
      reason: "failing_ci",
      attentionRequired: true,
    });
    expect(
      failingCiSignals[0]?.evidence?.some((entry) =>
        entry.text?.includes("review_requested"),
      ),
    ).toBe(true);

    expect(byId.get("github:pr:brocorp/aspex#103")).toMatchObject({
      source: "github",
      reason: "awaiting_merge",
      attentionRequired: true,
    });
    expect(byId.get("github:pr:brocorp/aspex#103")?.actions).toEqual([
      {
        id: "merge",
        label: "Merge",
        risk: "dangerous",
        requiresConfirmation: true,
      },
    ]);
    expect(byId.get("claude-code:session:blocked-demo")).toMatchObject({
      source: "claude-code",
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      actions: [],
    });

    expect(
      signals
        .filter((entry) => entry.id === "claude-code:session:finishes-demo")
        .map((entry) => entry.state),
    ).toEqual(["working", "done"]);
    expect(byId.get("claude-code:session:finishes-demo")).toMatchObject({
      state: "done",
      reason: "ambient",
      attentionRequired: false,
    });
    expect(byId.get("claude-code:session:liveness-demo")).toMatchObject({
      source: "claude-code",
      state: "working",
      reason: "ambient",
      attentionRequired: false,
    });
    expect(byId.get("webhook:deploy/aspex-preview")).toMatchObject({
      source: "webhook",
      state: "working",
      reason: "ambient",
      attentionRequired: false,
    });
  });

  test("emits scripted Signals in atMs order", async () => {
    const clock = new FakeClock();
    const entries: MockScriptEntry[] = [
      { atMs: 20, signal: signal({ id: "github:pr:o/r#2" }) },
      { atMs: 10, signal: signal({ id: "github:pr:o/r#1" }) },
    ];
    const adapter = new MockAdapter({
      script: entries,
      setTimeout: clock.setTimeout as typeof setTimeout,
      clearTimeout: clock.clearTimeout as typeof clearTimeout,
    });
    const { ctx, emitted, logs } = context();

    await adapter.start(ctx);
    clock.advanceTo(9);
    expect(emitted).toEqual([]);

    clock.advanceTo(20);
    expect(emitted.map((item) => item.id)).toEqual([
      "github:pr:o/r#1",
      "github:pr:o/r#2",
    ]);
    expect(logs).toEqual(["scheduled 2 mock Signals"]);
  });

  test("captures baked Signal actions for demo action routing", async () => {
    const clock = new FakeClock();
    const adapter = new MockAdapter({
      script: [{ atMs: 0, signal: signal() }],
      setTimeout: clock.setTimeout as typeof setTimeout,
      clearTimeout: clock.clearTimeout as typeof clearTimeout,
    });
    const { ctx } = context();

    await adapter.start(ctx);

    expect(adapter.listActions("github:pr:o/r#1")).toEqual([
      {
        id: "approve",
        label: "Approve",
        risk: "safe",
        requiresConfirmation: false,
      },
    ]);
    await expect(
      adapter.runAction("github:pr:o/r#1", "approve"),
    ).resolves.toEqual({ ok: true, message: "mock action" });
    await expect(
      adapter.runAction("github:pr:o/r#1", "missing"),
    ).resolves.toEqual({ ok: false, message: "Unknown mock action" });
  });

  test("schedules working heartbeats and excludes the liveness stop-emitting demo", async () => {
    const clock = new FakeClock();
    const adapter = new MockAdapter({
      script: [
        {
          atMs: 400,
          signal: signal({
            id: "claude-code:session:finishes-demo",
            source: "claude-code",
            state: "working",
          }),
        },
        {
          atMs: 650,
          signal: signal({
            id: "claude-code:session:finishes-demo",
            source: "claude-code",
            state: "done",
          }),
        },
        {
          atMs: 800,
          signal: signal({
            id: "claude-code:session:liveness-demo",
            source: "claude-code",
            state: "working",
          }),
        },
      ],
      setTimeout: clock.setTimeout as typeof setTimeout,
      clearTimeout: clock.clearTimeout as typeof clearTimeout,
    });
    const { ctx, heartbeats } = context();

    await adapter.start(ctx);
    clock.advanceTo(519);
    expect(heartbeats).toEqual([]);

    clock.advanceTo(520);
    expect(heartbeats).toEqual(["claude-code"]);

    clock.advanceTo(640);
    expect(heartbeats).toEqual(["claude-code", "claude-code"]);

    clock.advanceTo(1_000);
    expect(heartbeats).toEqual(["claude-code", "claude-code"]);
  });

  test("stop clears pending timers", async () => {
    const clock = new FakeClock();
    const adapter = new MockAdapter({
      script: [{ atMs: 100, signal: signal() }],
      setTimeout: clock.setTimeout as typeof setTimeout,
      clearTimeout: clock.clearTimeout as typeof clearTimeout,
    });
    const { ctx, emitted } = context();

    await adapter.start(ctx);
    expect(clock.pendingCount()).toBe(1);

    await adapter.stop();
    expect(clock.pendingCount()).toBe(0);

    clock.advanceTo(1_000);
    expect(emitted).toEqual([]);
  });
});

async function loadDemoScript(): Promise<MockScriptEntry[]> {
  const raw = await Bun.file(
    new URL("../../../examples/mock-events/script.json", import.meta.url),
  ).json();

  return raw as MockScriptEntry[];
}
