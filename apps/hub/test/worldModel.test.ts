import { describe, expect, test } from "bun:test";
import type { AttentionItem } from "@aspex/schema";
import { Bus, type HubEvents } from "../src/bus";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { type Derivers, WorldModel } from "../src/world/worldModel";

const identityDerivers: Derivers = {
  deriveAttention: (item) => item,
  deriveLiveness: (item) => item,
};

function openWorldModel(): {
  db: ReturnType<typeof openDb>;
  bus: Bus;
  store: ItemStore;
  worldModel: WorldModel;
  changes: HubEvents["world:changed"][];
} {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const changes: HubEvents["world:changed"][] = [];

  bus.on("world:changed", (event) => changes.push(event));

  return {
    db,
    bus,
    store,
    worldModel: new WorldModel(store, bus, identityDerivers),
    changes,
  };
}

describe("WorldModel", () => {
  test("upserts Signals by id and lets later field values win", () => {
    const { db, worldModel } = openWorldModel();

    worldModel.applySignal({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "needs_review",
      severity: "medium",
      summary: "Review requested",
    });
    worldModel.applySignal({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "blocked",
      severity: "high",
      summary: "CI is blocked",
    });

    const snapshot = worldModel.snapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "blocked",
      severity: "high",
      summary: "CI is blocked",
    });

    db.close();
  });

  test("emits one world:changed diff for each applied Signal", () => {
    const { db, worldModel, changes } = openWorldModel();

    worldModel.applySignal({
      id: "codex:session:abc",
      source: "codex",
      project: "aspex",
      state: "working",
      summary: "Codex is working",
    });
    worldModel.applySignal({
      id: "codex:session:abc",
      source: "codex",
      project: "aspex",
      state: "blocked",
      summary: "Codex needs input",
    });

    expect(changes).toHaveLength(2);
    expect(changes[0]?.removed).toEqual([]);
    expect(changes[0]?.upserted).toHaveLength(1);
    expect(changes[0]?.upserted[0]).toMatchObject({
      id: "codex:session:abc",
      state: "working",
    });
    expect(changes[1]?.removed).toEqual([]);
    expect(changes[1]?.upserted).toHaveLength(1);
    expect(changes[1]?.upserted[0]).toMatchObject({
      id: "codex:session:abc",
      state: "blocked",
    });

    db.close();
  });

  test("preserves stored evidence and actions when a Signal omits them", () => {
    const { db, worldModel } = openWorldModel();
    const evidence: AttentionItem["evidence"] = [
      { label: "Pull request", url: "https://example.test/pr/42" },
    ];
    const actions: AttentionItem["actions"] = [
      {
        id: "view",
        label: "View PR",
        risk: "safe",
        requiresConfirmation: false,
      },
    ];

    worldModel.applySignal({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "needs_review",
      evidence,
      actions,
    });
    worldModel.applySignal({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "working",
      summary: "Reviewer responded",
    });

    expect(worldModel.snapshot()[0]).toMatchObject({
      evidence,
      actions,
      state: "working",
      summary: "Reviewer responded",
    });

    db.close();
  });

  test("defaults derivers to identity and creates a valid AttentionItem", () => {
    const db = openDb(":memory:");
    const bus = new Bus();
    const store = new ItemStore(db);
    const worldModel = new WorldModel(store, bus);

    worldModel.applySignal({
      id: "webhook:build:123",
      source: "webhook",
      project: "aspex",
      state: "working",
    });

    expect(worldModel.snapshot()[0]).toMatchObject({
      id: "webhook:build:123",
      source: "webhook",
      project: "aspex",
      state: "working",
      liveness: "live",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      summary: "",
      evidence: [],
      actions: [],
    });
    expect(typeof worldModel.snapshot()[0]?.observedAt).toBe("string");
    expect(typeof worldModel.snapshot()[0]?.staleAfter).toBe("string");

    db.close();
  });

  test("snapshot reads through ItemStore and remove emits the removed id", () => {
    const { db, store, worldModel, changes } = openWorldModel();
    const storedItem: AttentionItem = {
      id: "ntfy:alert:1",
      source: "ntfy",
      project: "aspex",
      state: "blocked",
      liveness: "live",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      summary: "Stored directly",
      evidence: [],
      actions: [],
      observedAt: new Date(0).toISOString(),
      staleAfter: new Date(5 * 60 * 1000).toISOString(),
    };

    store.upsert(storedItem);

    expect(worldModel.snapshot()).toEqual([storedItem]);

    worldModel.remove(storedItem.id);

    expect(worldModel.snapshot()).toEqual([]);
    expect(changes).toEqual([{ upserted: [], removed: [storedItem.id] }]);

    db.close();
  });
});
