import { describe, expect, test } from "bun:test";
import { CursorAdapter, mapCursorStatusChangeToSignal } from "../src";
import errorFixture from "./fixtures/error-status-change.json";
import finishedFixture from "./fixtures/finished-status-change.json";

describe("mapCursorStatusChangeToSignal", () => {
  test("maps ERROR statusChange to needs-me error attention", () => {
    const signal = mapCursorStatusChangeToSignal(errorFixture);

    expect(signal).toMatchObject({
      id: "cursor:agent:agent-error-1",
      source: "cursor",
      project: "aspex",
      session: "agent-error-1",
      state: "error",
      reason: "errored",
      attentionRequired: true,
      severity: "high",
      deepLink: "cursor://agent/agent-error-1",
      actions: [],
    });
  });

  test("maps FINISHED statusChange to ambient done", () => {
    const signal = mapCursorStatusChangeToSignal(finishedFixture);

    expect(signal).toMatchObject({
      id: "cursor:agent:agent-finished-1",
      source: "cursor",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      deepLink: "cursor://agent/agent-finished-1",
      actions: [],
    });
  });
});

describe("CursorAdapter", () => {
  test("refuses actions because cursor is observe-only", async () => {
    const adapter = new CursorAdapter();

    expect(adapter.listActions("cursor:agent:agent-error-1")).toEqual([]);
    await expect(
      adapter.runAction("cursor:agent:agent-error-1", "approve"),
    ).resolves.toEqual({
      ok: false,
      message: "cursor is observe-only in Phase 3",
    });
  });
});
