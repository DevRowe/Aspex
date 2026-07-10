import { describe, expect, test } from "bun:test";
import {
  isValidGilesTaskId,
  lastStatusEvent,
  parseBacklogInFlight,
  parseMeta,
  parseWorkerStateLine,
} from "../src/state";

const BACKLOG = `# Backlog

## In flight
- [ ] aspex-hub-core-d5 - Aspex: orchestrator protocol core (repo: Aspex) (kind: ship) (since 2026-07-10)
- [ ] numbat-pack-batch-p3 - Numbat Phase 0: batch generate + curation UI blocked-by: numbat-lora-freeze-p2 (repo: numbat-pipeline) (kind: ship) (since 2026-07-08)
  frozen style: A_watercolour_storybook; continuation line is not a task

## Queued
- [ ] queued-task-q1 - not in flight (repo: giles) (kind: ship)

## Done
- [x] done-task-x1 - merged already (repo: giles) (kind: ship) (merged 2026-07-10)
`;

describe("backlog parsing", () => {
  test("extracts only In flight tasks with repo and kind", () => {
    const refs = parseBacklogInFlight(BACKLOG);

    expect(refs).toEqual([
      {
        taskId: "aspex-hub-core-d5",
        title: "Aspex: orchestrator protocol core",
        repo: "Aspex",
        kind: "ship",
      },
      {
        taskId: "numbat-pack-batch-p3",
        title: "Numbat Phase 0: batch generate + curation UI",
        repo: "numbat-pipeline",
        kind: "ship",
      },
    ]);
  });

  test("returns nothing when there is no In flight section", () => {
    expect(parseBacklogInFlight("# Backlog\n\n## Done\n")).toEqual([]);
  });
});

describe("worker state line parsing", () => {
  test("parses the helper's three-field line", () => {
    expect(
      parseWorkerStateLine(
        "state: parked · source: run-step · awaiting_approval with 2 findings",
      ),
    ).toEqual({
      state: "parked",
      source: "run-step",
      detail: "awaiting_approval with 2 findings",
    });
  });

  test("parses a detail containing separators", () => {
    expect(
      parseWorkerStateLine(
        "state: working · source: status-log · totals: a 1 · b 2",
      ),
    ).toMatchObject({ state: "working", source: "status-log" });
  });

  test("returns null on malformed lines", () => {
    expect(parseWorkerStateLine("")).toBeNull();
    expect(
      parseWorkerStateLine("state: levitating · source: x · y"),
    ).toBeNull();
  });
});

describe("meta parsing", () => {
  test("parses key=value lines including values with equals signs", () => {
    expect(
      parseMeta(
        "project=/home/rowe/giles/projects/Aspex\nkind=ship\npr=https://github.com/o/r/pull/12?x=1\n",
      ),
    ).toEqual({
      project: "/home/rowe/giles/projects/Aspex",
      kind: "ship",
      pr: "https://github.com/o/r/pull/12?x=1",
    });
  });
});

describe("status log last event", () => {
  test("finds the last verb-prefixed line", () => {
    expect(
      lastStatusEvent(
        "working: started\nneeds-decision: pick a keeper per asset\nworking: resumed after answer\n",
      ),
    ).toEqual({ verb: "working", text: "resumed after answer" });
  });

  test("skips unparseable trailing lines", () => {
    expect(
      lastStatusEvent("blocked: waiting on owner\nnot a status line\n"),
    ).toEqual({ verb: "blocked", text: "waiting on owner" });
  });

  test("returns null for an empty log", () => {
    expect(lastStatusEvent("")).toBeNull();
  });
});

describe("task id validation", () => {
  test("accepts giles slugs and rejects path tricks", () => {
    expect(isValidGilesTaskId("numbat-pack-batch-p3")).toBe(true);
    expect(isValidGilesTaskId("../etc")).toBe(false);
    expect(isValidGilesTaskId("a/b")).toBe(false);
    expect(isValidGilesTaskId("")).toBe(false);
  });
});
