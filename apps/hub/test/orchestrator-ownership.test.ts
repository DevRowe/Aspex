import { describe, expect, test } from "bun:test";
import { type GilesTaskSnapshot, mapGilesTask } from "@aspex/adapter-giles";
import { Bus } from "../src/bus";
import { enforceOwnership, rank } from "../src/engine/attention";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

function snapshot(overrides: Partial<GilesTaskSnapshot>): GilesTaskSnapshot {
  return {
    ref: { taskId: "task-1", title: "A task", repo: "numbat", kind: "ship" },
    workerState: { state: "working", source: "run-step", detail: "" },
    meta: {},
    lastStatus: null,
    ...overrides,
  };
}

describe("orchestrator ownership (mapper composed with the engine)", () => {
  test("blocked-on-human giles task survives enforceOwnership and reaches needs-me", () => {
    const db = openDb(":memory:");
    const world = new WorldModel(new ItemStore(db), new Bus(), {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => item,
    });

    world.applySignal(
      mapGilesTask(
        "giles",
        snapshot({
          ref: {
            taskId: "auth-refactor-d3",
            title: "Auth refactor",
            repo: "numbat",
            kind: "ship",
          },
          workerState: {
            state: "parked",
            source: "run-step",
            detail: "parked",
          },
          lastStatus: {
            verb: "needs-decision",
            text: "owner must pick the session-store strategy",
          },
        }),
      ),
    );

    expect(world.snapshot()).toEqual([
      expect.objectContaining({
        id: "orchestrator:giles:auth-refactor-d3",
        source: "orchestrator",
        state: "blocked",
        reason: "blocked_on_human",
        attentionRequired: true,
        severity: "high",
      }),
    ]);

    const view = rank(world.snapshot(), 5);

    expect(view.needsMe.map((item) => item.id)).toEqual([
      "orchestrator:giles:auth-refactor-d3",
    ]);

    db.close();
  });

  test("working giles task stays ambient through the engine", () => {
    const db = openDb(":memory:");
    const world = new WorldModel(new ItemStore(db), new Bus(), {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => item,
    });

    world.applySignal(mapGilesTask("giles", snapshot({})));

    expect(world.snapshot()).toEqual([
      expect.objectContaining({
        id: "orchestrator:giles:task-1",
        reason: "ambient",
        attentionRequired: false,
      }),
    ]);
    expect(rank(world.snapshot(), 5).needsMe).toEqual([]);

    db.close();
  });
});
