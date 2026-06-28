import { describe, expect, test } from "bun:test";
import { mapCodexNotifyToSignal } from "@aspex/adapter-codex";
import { mapCursorStatusChangeToSignal } from "@aspex/adapter-cursor";
import { isHeartbeatResult, mapEvent } from "@aspex/adapter-opencode";
import type { Reason, Signal } from "@aspex/schema";
import codexFixture from "../../../packages/adapter-codex/test/fixtures/agent-turn-complete.json";
import cursorErrorFixture from "../../../packages/adapter-cursor/test/fixtures/error-status-change.json";
import cursorFinishedFixture from "../../../packages/adapter-cursor/test/fixtures/finished-status-change.json";
import { Bus } from "../src/bus";
import { enforceOwnership } from "../src/engine/attention";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

const prLifecycleReasons = new Set<Reason>([
  "review_requested",
  "failing_ci",
  "awaiting_merge",
]);

describe("new adapter ownership partition", () => {
  test("codex, opencode, and cursor fixtures do not emit PR lifecycle reasons", async () => {
    const signals = await mappedSignals();

    expect(signals.length).toBeGreaterThan(0);
    expect(
      signals.filter((signal) =>
        prLifecycleReasons.has(signal.reason ?? "ambient"),
      ),
    ).toEqual([]);
  });

  test("real ownership keeps cursor ERROR needs-me and FINISHED ambient", async () => {
    const db = openDb(":memory:");
    const world = new WorldModel(new ItemStore(db), new Bus(), {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => item,
    });

    for (const signal of await mappedSignals()) {
      world.applySignal(signal);
    }

    expect(world.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cursor:agent:agent-error-1",
          source: "cursor",
          state: "error",
          reason: "errored",
          attentionRequired: true,
        }),
        expect.objectContaining({
          id: "cursor:agent:agent-finished-1",
          source: "cursor",
          state: "done",
          reason: "ambient",
          attentionRequired: false,
        }),
      ]),
    );

    for (const item of world
      .snapshot()
      .filter((item) => item.source !== "github")) {
      expect(prLifecycleReasons.has(item.reason)).toBe(false);
    }

    db.close();
  });
});

async function mappedSignals(): Promise<Signal[]> {
  const signals: Signal[] = [];
  const codex = mapCodexNotifyToSignal(codexFixture);
  const cursorError = mapCursorStatusChangeToSignal(cursorErrorFixture);
  const cursorFinished = mapCursorStatusChangeToSignal(cursorFinishedFixture);

  if (codex !== null) {
    signals.push(codex);
  }

  if (cursorError !== null) {
    signals.push(cursorError);
  }

  if (cursorFinished !== null) {
    signals.push(cursorFinished);
  }

  for (const event of await opencodeEvents()) {
    const result = mapEvent(event, {
      serverUrl: "http://127.0.0.1:4096",
      directory: "D:\\BroCorp\\Aspex",
    });

    if (result !== null && !isHeartbeatResult(result)) {
      signals.push(result);
    }
  }

  return signals;
}

async function opencodeEvents(): Promise<unknown[]> {
  const raw = await Bun.file(
    new URL(
      "../../../packages/adapter-opencode/test/fixtures/opencode-events.jsonl",
      import.meta.url,
    ),
  ).text();

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}
