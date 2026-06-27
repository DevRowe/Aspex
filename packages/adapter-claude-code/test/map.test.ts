import { describe, expect, test } from "bun:test";
import { Bus } from "../../../apps/hub/src/bus";
import { enforceOwnership } from "../../../apps/hub/src/engine/attention";
import {
  livenessAt,
  nextStaleAfter,
} from "../../../apps/hub/src/engine/liveness";
import { buildApp } from "../../../apps/hub/src/http/server";
import { openDb } from "../../../apps/hub/src/store/db";
import { ItemStore } from "../../../apps/hub/src/store/itemStore";
import { WorldModel } from "../../../apps/hub/src/world/worldModel";
import { ClaudeCodeAdapter, mapClaudeHookToSignal } from "../src";

describe("Claude Code hook mapping", () => {
  test("Notification maps to a blocked needs-me item with no actions and a deepLink", () => {
    const signal = mapClaudeHookToSignal("Notification", {
      session_id: "abc",
      cwd: "D:\\BroCorp\\Aspex",
      transcript_path: "D:\\tmp\\transcript.jsonl",
      message: "Approve the next command?",
    });

    expect(signal).toMatchObject({
      id: "claude-code:session:abc",
      source: "claude-code",
      project: "Aspex",
      session: "abc",
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      actions: [],
      deepLink: "D:\\BroCorp\\Aspex",
      summary: "Approve the next command?",
    });
  });

  test("Stop maps to Ambient done without attention", () => {
    const signal = mapClaudeHookToSignal("Stop", {
      session_id: "abc",
      cwd: "/work/aspex",
    });

    expect(signal).toMatchObject({
      id: "claude-code:session:abc",
      source: "claude-code",
      project: "aspex",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
    });
  });

  test("PostToolUse maps to a heartbeat marker", () => {
    const signal = mapClaudeHookToSignal("PostToolUse", {
      session_id: "abc",
      cwd: "/work/aspex",
      tool_name: "Edit",
    });

    expect(signal).toMatchObject({
      id: "claude-code:session:abc",
      source: "claude-code",
      state: "working",
      heartbeat: true,
    });
  });

  test("heartbeat POST ignores malformed new items and accepts mapped heartbeats", async () => {
    const db = openDb(":memory:");
    const bus = new Bus();
    const worldModel = new WorldModel(new ItemStore(db), bus, {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => item,
    });
    const app = buildApp({
      worldModel,
      bus,
      cap: 7,
      version: "test",
      actionMeta: () => null,
      dispatchAction: async () => ({ ok: false }),
    });

    try {
      const malformed = await app.fetch(
        new Request("http://hub.test/signals/claude-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "claude-code:session:abc",
            source: "claude-code",
            state: "working",
            heartbeat: true,
          }),
        }),
      );

      expect(malformed.status).toBe(202);
      expect(worldModel.snapshot()).toEqual([]);

      const heartbeat = mapClaudeHookToSignal("PostToolUse", {
        session_id: "abc",
        cwd: "/work/aspex",
        tool_name: "Edit",
      });
      const accepted = await app.fetch(
        new Request("http://hub.test/signals/claude-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(heartbeat),
        }),
      );

      expect(accepted.status).toBe(202);
      expect(worldModel.snapshot()[0]).toMatchObject({
        id: "claude-code:session:abc",
        source: "claude-code",
        project: "aspex",
        session: "abc",
        state: "working",
        attentionRequired: false,
        reason: "ambient",
      });
    } finally {
      db.close();
    }
  });

  test("runAction returns a read-only refusal", async () => {
    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.runAction("claude-code:session:abc", "reply"),
    ).resolves.toEqual({
      ok: false,
      message: "read-only in Phase 0",
    });
    expect(adapter.listActions("claude-code:session:abc")).toEqual([]);
  });

  test("PostToolUse heartbeat refreshes liveness without changing a blocked item to working", async () => {
    const db = openDb(":memory:");
    const bus = new Bus();
    const cfg = {
      pollGraceMs: 90_000,
      heartbeatGraceMs: 120_000,
      quietAfterMs: 30_000,
      staleAfterMs: 90_000,
      lostAfterMs: 180_000,
    };
    const worldModel = new WorldModel(new ItemStore(db), bus, {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => {
        const withStaleAfter = {
          ...item,
          staleAfter: nextStaleAfter(
            item.source,
            item.state,
            item.observedAt,
            cfg,
          ),
        };

        return {
          ...withStaleAfter,
          liveness: livenessAt(withStaleAfter, Date.now(), cfg),
        };
      },
    });
    const app = buildApp({
      worldModel,
      bus,
      cap: 7,
      version: "test",
      actionMeta: () => null,
      dispatchAction: async () => ({ ok: false }),
    });

    try {
      const notification = mapClaudeHookToSignal("Notification", {
        session_id: "abc",
        cwd: "/work/aspex",
        message: "Need approval",
      });
      const heartbeat = mapClaudeHookToSignal("PostToolUse", {
        session_id: "abc",
        cwd: "/work/aspex",
        tool_name: "Edit",
      });

      await app.fetch(
        new Request("http://hub.test/signals/claude-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(notification),
        }),
      );
      const before = worldModel.snapshot()[0];

      await Bun.sleep(2);
      await app.fetch(
        new Request("http://hub.test/signals/claude-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(heartbeat),
        }),
      );

      const after = worldModel.snapshot()[0];

      expect(before).toMatchObject({
        state: "blocked",
        attentionRequired: true,
        reason: "blocked_on_human",
      });
      expect(after).toMatchObject({
        state: "blocked",
        attentionRequired: true,
        reason: "blocked_on_human",
        liveness: "live",
      });
      expect(Date.parse(after?.staleAfter ?? "")).toBeGreaterThan(
        Date.parse(before?.staleAfter ?? ""),
      );
    } finally {
      db.close();
    }
  });
});
