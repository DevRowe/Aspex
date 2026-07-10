import { describe, expect, test } from "bun:test";
import { isValidSignal } from "@aspex/schema";
import {
  type GilesTaskSnapshot,
  mapDepartedGilesTask,
  mapGilesTask,
} from "../src/map";

function snapshot(overrides: Partial<GilesTaskSnapshot>): GilesTaskSnapshot {
  return {
    ref: { taskId: "task-1", title: "A task", repo: "numbat", kind: "ship" },
    workerState: { state: "working", source: "run-step", detail: "" },
    meta: {},
    lastStatus: null,
    ...overrides,
  };
}

describe("giles lifecycle mapping (design 2.3 table)", () => {
  test("working is ambient with redirect+status", () => {
    const signal = mapGilesTask("giles", snapshot({}));

    expect(isValidSignal(signal)).toBe(true);
    expect(signal).toMatchObject({
      id: "orchestrator:giles:task-1",
      source: "orchestrator",
      state: "working",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual(["redirect", "status"]);
  });

  test("parked at a no-mistakes gate offers approve/deny/redirect", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        workerState: {
          state: "parked",
          source: "run-step",
          detail: "awaiting_approval with 2 findings",
        },
        lastStatus: { verb: "working", text: "validating" },
      }),
    );

    expect(signal).toMatchObject({
      state: "needs_review",
      reason: "review_requested",
      attentionRequired: true,
      severity: "medium",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual([
      "approve",
      "deny",
      "redirect",
    ]);
  });

  test("parked with a needs-decision log is blocked on the human (the design's live example)", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        ref: {
          taskId: "numbat-pack-batch-p3",
          title: "Numbat pack batch",
          repo: "numbat-pipeline",
          kind: "ship",
        },
        workerState: { state: "parked", source: "run-step", detail: "parked" },
        lastStatus: {
          verb: "needs-decision",
          text: "owner must pick one keeper per asset ID (128 assets)",
        },
      }),
    );

    expect(signal).toMatchObject({
      id: "orchestrator:giles:numbat-pack-batch-p3",
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      severity: "high",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual(["answer", "redirect"]);
    expect(signal.summary).toContain("keeper per asset");
  });

  test("done with a PR is ready to ship, dangerous and confirmed", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        ref: {
          taskId: "numbat-tracing-g3",
          title: "Letter-tracing activity",
          repo: "numbat",
          kind: "ship",
        },
        workerState: {
          state: "done",
          source: "run-step",
          detail: "checks green",
        },
        meta: {
          pr: "https://github.com/DevRowe/numbat/pull/12",
          project: "/home/rowe/giles/projects/numbat",
          harness: "claude",
        },
      }),
    );

    expect(signal).toMatchObject({
      state: "needs_review",
      reason: "awaiting_merge",
      severity: "medium",
      project: "numbat",
      actor: "giles-worker/claude",
      deepLink: "https://github.com/DevRowe/numbat/pull/12",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual([
      "ship",
      "deny",
      "redirect",
    ]);
    const ship = signal.actions?.find((a) => a.id === "ship");
    expect(ship).toMatchObject({
      risk: "dangerous",
      requiresConfirmation: true,
    });
    expect(signal.evidence).toContainEqual({
      label: "PR",
      url: "https://github.com/DevRowe/numbat/pull/12",
    });
  });

  test("a done scout offers only status (read the finding)", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        ref: {
          taskId: "scout-1",
          title: "Scout it",
          repo: "giles",
          kind: "scout",
        },
        workerState: {
          state: "done",
          source: "run-step",
          detail: "report written",
        },
      }),
    );

    expect(signal).toMatchObject({
      state: "needs_review",
      reason: "review_requested",
      severity: "low",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual(["status"]);
  });

  test("failed maps to error/errored/high", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        workerState: {
          state: "failed",
          source: "run-step",
          detail: "run failed",
        },
      }),
    );

    expect(signal).toMatchObject({
      state: "error",
      reason: "errored",
      attentionRequired: true,
      severity: "high",
    });
    expect(signal.actions?.map((a) => a.id)).toEqual(["status", "redirect"]);
  });

  test("answer stays unconfirmed-safe; redirect and dispatch-class verbs confirm", () => {
    const signal = mapGilesTask(
      "giles",
      snapshot({
        workerState: {
          state: "blocked",
          source: "status-log",
          detail: "stuck",
        },
      }),
    );
    const answer = signal.actions?.find((a) => a.id === "answer");
    const redirect = signal.actions?.find((a) => a.id === "redirect");

    expect(answer).toMatchObject({ risk: "safe", requiresConfirmation: false });
    expect(redirect).toMatchObject({
      risk: "medium",
      requiresConfirmation: true,
    });
  });

  test("a departed task emits a terminal ambient done", () => {
    expect(mapDepartedGilesTask("giles", "task-9")).toEqual({
      id: "orchestrator:giles:task-9",
      source: "orchestrator",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      actions: [],
    });
  });
});
