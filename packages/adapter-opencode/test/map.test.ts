import { describe, expect, test } from "bun:test";
import { OpenCodeAdapter } from "../src";
import { isHeartbeatResult, mapEvent } from "../src/map";

const options = {
  serverUrl: "http://127.0.0.1:4096",
  directory: "D:\\BroCorp\\Aspex",
};

describe("mapEvent", () => {
  test("maps awaiting input to blocked attention", () => {
    const result = mapEvent(
      {
        type: "session.updated",
        session: { id: "abc", status: "awaiting_input" },
        message: "Approve command?",
      },
      options,
    );

    expect(result).toMatchObject({
      id: "opencode:session:abc",
      source: "opencode",
      project: "Aspex",
      session: "abc",
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      severity: "high",
      actions: [],
      deepLink: "http://127.0.0.1:4096/session/abc",
    });
  });

  test("maps errors to errored attention", () => {
    const result = mapEvent(
      {
        type: "session.updated",
        session: { id: "abc", status: "aborted" },
      },
      options,
    );

    expect(result).toMatchObject({
      id: "opencode:session:abc",
      state: "error",
      reason: "errored",
      attentionRequired: true,
    });
  });

  test("maps completion to ambient done", () => {
    const result = mapEvent(
      {
        type: "session.updated",
        session: { id: "abc", status: "idle" },
      },
      options,
    );

    expect(result).toMatchObject({
      id: "opencode:session:abc",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
    });
  });

  test("maps running and message events to heartbeat-only results", () => {
    const result = mapEvent(
      {
        type: "message.updated",
        session: { id: "abc", status: "running" },
      },
      options,
    );

    expect(isHeartbeatResult(result)).toBe(true);
  });
});

describe("OpenCodeAdapter", () => {
  test("refuses actions because opencode is observe-only", async () => {
    const adapter = new OpenCodeAdapter({
      enabled: true,
      serverUrl: "http://127.0.0.1:4096",
    });

    expect(adapter.listActions("opencode:session:abc")).toEqual([]);
    await expect(
      adapter.runAction("opencode:session:abc", "approve"),
    ).resolves.toEqual({
      ok: false,
      message: "opencode is observe-only in Phase 3",
    });
  });

  test("does nothing when disabled", async () => {
    let fetchCalls = 0;
    const adapter = new OpenCodeAdapter(
      { enabled: false, serverUrl: "http://127.0.0.1:4096" },
      {
        fetch: async () => {
          fetchCalls += 1;
          throw new Error("should not connect");
        },
      },
    );
    const emitted: unknown[] = [];
    const heartbeats: string[] = [];

    await adapter.start({
      emit: (signal) => emitted.push(signal),
      heartbeat: (source) => heartbeats.push(source),
      log: () => {},
    });

    expect(fetchCalls).toBe(0);
    expect(emitted).toEqual([]);
    expect(heartbeats).toEqual([]);
  });
});
