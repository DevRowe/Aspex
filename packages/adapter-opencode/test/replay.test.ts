import { describe, expect, test } from "bun:test";
import type { Signal } from "@aspex/schema";
import { isHeartbeatResult, mapEvent } from "../src/map";

interface ReplayItem {
  id: string;
  source: string;
  state: string;
  reason?: string;
  attentionRequired?: boolean;
  actions?: unknown[];
  deepLink?: string;
}

describe("opencode fixture replay", () => {
  test("replays recorded /event lines without requiring an opencode server", async () => {
    const events = await loadFixture("opencode-events.jsonl");
    const items = new Map<string, ReplayItem>();
    let heartbeatCount = 0;

    for (const event of events) {
      heartbeatCount += 1;
      const result = mapEvent(event, {
        serverUrl: "http://127.0.0.1:4096",
        directory: "D:\\BroCorp\\Aspex",
      });

      if (result === null) {
        continue;
      }

      if (isHeartbeatResult(result)) {
        continue;
      }

      applySignal(items, result);
    }

    expect(heartbeatCount).toBe(events.length);
    expect(items.get("opencode:session:blocked-1")).toMatchObject({
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      actions: [],
      deepLink: "http://127.0.0.1:4096/session/blocked-1",
    });
    expect(items.get("opencode:session:error-1")).toMatchObject({
      state: "error",
      attentionRequired: true,
    });
    expect(items.get("opencode:session:done-1")).toMatchObject({
      state: "done",
      reason: "ambient",
      attentionRequired: false,
    });
  });

  test("running message events are heartbeat-only and do not unblock an item", async () => {
    const events = await loadFixture("opencode-events.jsonl");
    const items = new Map<string, ReplayItem>();

    for (const event of events) {
      const result = mapEvent(event, {
        serverUrl: "http://127.0.0.1:4096",
        directory: "D:\\BroCorp\\Aspex",
      });

      if (result !== null && !isHeartbeatResult(result)) {
        applySignal(items, result);
      }
    }

    expect(items.get("opencode:session:blocked-1")).toMatchObject({
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
    });
  });
});

function applySignal(items: Map<string, ReplayItem>, signal: Signal): void {
  const existing = items.get(signal.id) ?? {};

  items.set(signal.id, {
    ...existing,
    ...signal,
  } as ReplayItem);
}

async function loadFixture(name: string): Promise<unknown[]> {
  const path = new URL(`./fixtures/${name}`, import.meta.url);
  const raw = await Bun.file(path).text();

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}
