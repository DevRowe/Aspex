import { describe, expect, test } from "bun:test";
import {
  type Action,
  type ActionResult,
  type Adapter,
  type AdapterContext,
  type AttentionItem,
  webhookId,
} from "@aspex/schema";
import { AdapterRegistry } from "../src/adapters/registry";
import { Bus, type HubEvents } from "../src/bus";
import { type LivenessConfig, LivenessTicker } from "../src/engine/liveness";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { type Derivers, WorldModel } from "../src/world/worldModel";

type RouteCase = {
  adapterId: string;
  itemId: string;
};

const routedSources: RouteCase[] = [
  { adapterId: "github", itemId: "github:pr:o/r#1" },
  { adapterId: "claude-code", itemId: "claude-code:session:abc" },
  { adapterId: "webhook", itemId: webhookId("build/agent#alpha") },
  { adapterId: "codex", itemId: "codex:session:abc" },
];

const identityDerivers: Derivers = {
  deriveAttention: (item) => item,
  deriveLiveness: (item) => item,
};

const cfg: LivenessConfig = {
  pollGraceMs: 90_000,
  heartbeatGraceMs: 120_000,
  quietAfterMs: 30_000,
  staleAfterMs: 90_000,
  lostAfterMs: 180_000,
};

const baseNow = Date.parse("2026-06-28T00:00:00.000Z");

class FakeAdapter implements Adapter {
  ctx: AdapterContext | null = null;
  runCalls: { itemId: string; actionId: string; payload?: unknown }[] = [];
  startCalls = 0;
  stopCalls = 0;

  constructor(
    readonly id: string,
    private actions: Action[] = [],
  ) {}

  async start(ctx: AdapterContext): Promise<void> {
    this.startCalls += 1;
    this.ctx = ctx;
  }

  listActions(): Action[] {
    return this.actions;
  }

  async runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    this.runCalls.push({ itemId, actionId, payload });

    return { ok: true, message: `${this.id}:${actionId}` };
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

function openRegistry(
  now = baseNow,
  derivers: Derivers = identityDerivers,
): {
  db: ReturnType<typeof openDb>;
  world: WorldModel;
  registry: AdapterRegistry;
  changes: HubEvents["world:changed"][];
} {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const world = new WorldModel(store, bus, derivers);
  const changes: HubEvents["world:changed"][] = [];
  const liveness = new LivenessTicker(
    () => world.snapshot(),
    (item) => world.updateItem(item),
    cfg,
    () => now,
  );

  bus.on("world:changed", (event) => changes.push(event));

  return {
    db,
    world,
    registry: new AdapterRegistry(world, liveness),
    changes,
  };
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: "approve",
    label: "Approve",
    risk: "safe",
    requiresConfirmation: false,
    ...overrides,
  };
}

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "claude-code:session:abc",
    source: "claude-code",
    project: "aspex",
    state: "working",
    liveness: "lost",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
    summary: "Claude Code is working",
    evidence: [],
    actions: [],
    observedAt: new Date(baseNow - cfg.lostAfterMs).toISOString(),
    staleAfter: new Date(baseNow - cfg.lostAfterMs).toISOString(),
    ...overrides,
  };
}

describe("AdapterRegistry", () => {
  test("start gives a registered adapter a context whose emit applies a Signal", async () => {
    const { db, world, registry } = openRegistry();
    const github = new FakeAdapter("github");

    registry.register(github);
    await registry.startAll();

    expect(github.startCalls).toBe(1);
    expect(github.ctx).not.toBeNull();

    github.ctx?.emit({
      id: "github:pr:o/r#1",
      source: "github",
      project: "o/r",
      state: "needs_review",
      summary: "Review requested",
    });

    expect(world.snapshot()).toHaveLength(1);
    expect(world.snapshot()[0]).toMatchObject({
      id: "github:pr:o/r#1",
      source: "github",
      state: "needs_review",
      summary: "Review requested",
    });

    db.close();
  });

  test("dispatchAction routes by source parsed from the Item id", async () => {
    const { db, registry } = openRegistry();
    const adapters = new Map(
      routedSources.map(({ adapterId }) => [
        adapterId,
        new FakeAdapter(adapterId, [action()]),
      ]),
    );
    const payload = { body: "ship it" };

    for (const adapter of adapters.values()) {
      registry.register(adapter);
    }

    for (const { adapterId, itemId } of routedSources) {
      const result = await registry.dispatchAction(itemId, "approve", payload);

      expect(result).toEqual({ ok: true, message: `${adapterId}:approve` });
      expect(adapters.get(adapterId)?.runCalls).toEqual([
        { itemId, actionId: "approve", payload },
      ]);
    }

    db.close();
  });

  test("actionMeta returns the action's confirmation requirement", () => {
    const { db, registry } = openRegistry();
    const github = new FakeAdapter("github", [
      action({ id: "merge", label: "Merge", requiresConfirmation: true }),
    ]);

    registry.register(github);

    expect(registry.actionMeta("github:pr:o/r#1", "merge")).toEqual({
      requiresConfirmation: true,
    });
    expect(registry.actionMeta("github:pr:o/r#1", "approve")).toBeNull();

    db.close();
  });

  test("unknown source and unknown action return graceful failures", async () => {
    const { db, registry } = openRegistry();
    const github = new FakeAdapter("github", [action()]);
    const webhook = new FakeAdapter("webhook", [action()]);

    registry.register(github);
    registry.register(webhook);

    await expect(
      registry.dispatchAction("unknown:item:1", "approve"),
    ).resolves.toEqual({ ok: false, message: "No adapter for item source" });
    await expect(
      registry.dispatchAction("webhook::bad", "approve"),
    ).resolves.toEqual({ ok: false, message: "No adapter for item source" });
    await expect(
      registry.dispatchAction("github:pr:o/r#1", "missing"),
    ).resolves.toEqual({ ok: false, message: "Unknown action" });
    expect(github.runCalls).toEqual([]);
    expect(webhook.runCalls).toEqual([]);

    db.close();
  });

  test("heartbeat refreshes matching-source Items without changing state or observedAt", async () => {
    let deriveAttentionCalls = 0;
    let deriveLivenessCalls = 0;
    const derivers: Derivers = {
      deriveAttention: (current) => {
        deriveAttentionCalls += 1;
        return current;
      },
      deriveLiveness: (current) => {
        deriveLivenessCalls += 1;
        return current;
      },
    };
    const { db, world, registry, changes } = openRegistry(baseNow, derivers);
    const claude = new FakeAdapter("claude-code");
    const github = item({
      id: "github:pr:o/r#1",
      source: "github",
      project: "o/r",
      state: "needs_review",
    });

    registry.register(claude);
    await registry.startAll();

    world.applySignal(item());
    world.applySignal(github);

    const beforeHeartbeatChanges = changes.length;
    const beforeDeriveAttentionCalls = deriveAttentionCalls;
    const beforeDeriveLivenessCalls = deriveLivenessCalls;
    const beforeObservedAt = world
      .snapshot()
      .find((current) => current.id === item().id)?.observedAt;

    claude.ctx?.heartbeat("claude-code");

    const snapshot = world.snapshot();
    const refreshed = snapshot.find((current) => current.id === item().id);
    const untouched = snapshot.find((current) => current.id === github.id);

    expect(refreshed).toMatchObject({
      id: "claude-code:session:abc",
      state: "working",
      liveness: "live",
      staleAfter: new Date(baseNow + cfg.heartbeatGraceMs).toISOString(),
    });
    expect(refreshed?.observedAt).toBe(beforeObservedAt);
    expect(untouched).toMatchObject({
      id: "github:pr:o/r#1",
      state: "needs_review",
      liveness: "lost",
      staleAfter: new Date(baseNow - cfg.lostAfterMs).toISOString(),
    });
    expect(deriveAttentionCalls).toBe(beforeDeriveAttentionCalls);
    expect(deriveLivenessCalls).toBe(beforeDeriveLivenessCalls);
    expect(changes).toHaveLength(beforeHeartbeatChanges + 1);
    expect(changes.at(-1)?.upserted[0]).toMatchObject({
      id: "claude-code:session:abc",
      state: "working",
      liveness: "live",
    });

    db.close();
  });

  test("stopAll stops registered adapters", async () => {
    const { db, registry } = openRegistry();
    const github = new FakeAdapter("github");
    const codex = new FakeAdapter("codex");

    registry.register(github);
    registry.register(codex);

    await registry.stopAll();

    expect(github.stopCalls).toBe(1);
    expect(codex.stopCalls).toBe(1);

    db.close();
  });
});
