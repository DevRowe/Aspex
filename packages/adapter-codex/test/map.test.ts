import { describe, expect, test } from "bun:test";
import { CodexAdapter, mapCodexNotifyToSignal } from "../src";
import fixture from "./fixtures/agent-turn-complete.json";

describe("Codex notify mapping", () => {
  test("agent-turn-complete maps to an Ambient done item with a deepLink", () => {
    const signal = mapCodexNotifyToSignal(fixture);

    expect(signal).toMatchObject({
      id: "codex:session:thread-123",
      source: "codex",
      project: "Aspex",
      session: "thread-123",
      actor: "codex",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      actions: [],
      deepLink: "D:\\BroCorp\\Aspex",
      summary: "Codex turn completed",
      heartbeat: true,
    });
  });

  test("same thread id produces a stable upsert id", () => {
    const first = mapCodexNotifyToSignal({
      type: "agent-turn-complete",
      "thread-id": "stable",
      cwd: "/work/aspex",
    });
    const second = mapCodexNotifyToSignal({
      type: "agent-turn-complete",
      "thread-id": "stable",
      cwd: "/work/aspex",
    });

    expect(first?.id).toBe("codex:session:stable");
    expect(second?.id).toBe(first?.id);
  });

  test("malformed payload maps quietly to null", () => {
    expect(mapCodexNotifyToSignal(null)).toBeNull();
    expect(mapCodexNotifyToSignal("not-json")).toBeNull();
    expect(mapCodexNotifyToSignal({ type: "agent-turn-complete" })).toBeNull();
    expect(
      mapCodexNotifyToSignal({ type: "unknown", "thread-id": "abc" }),
    ).toBeNull();
  });

  test("runAction returns an observe-only refusal", async () => {
    const adapter = new CodexAdapter();

    await expect(
      adapter.runAction("codex:session:abc", "reply"),
    ).resolves.toEqual({
      ok: false,
      message: "codex is observe-only in Phase 3",
    });
    expect(adapter.listActions("codex:session:abc")).toEqual([]);
  });
});
