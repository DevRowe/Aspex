import { describe, expect, test } from "bun:test";
import type { AttentionItem } from "@aspex/schema";
import {
  type LivenessConfig,
  LivenessTicker,
  livenessAt,
  nextStaleAfter,
} from "../src/engine/liveness";

const cfg: LivenessConfig = {
  pollGraceMs: 90_000,
  heartbeatGraceMs: 120_000,
  quietAfterMs: 30_000,
  staleAfterMs: 90_000,
  lostAfterMs: 180_000,
};

const baseNow = Date.parse("2026-06-28T00:00:00.000Z");

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "claude-code:session:abc",
    source: "claude-code",
    project: "aspex",
    state: "working",
    liveness: "live",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
    summary: "Claude Code is working",
    evidence: [],
    actions: [],
    observedAt: iso(baseNow),
    staleAfter: iso(baseNow),
    ...overrides,
  };
}

describe("livenessAt", () => {
  test("push-source working Item decays quiet, stale, then lost after threshold grace", () => {
    const source = item({ staleAfter: iso(baseNow) });

    expect(livenessAt(source, baseNow + cfg.quietAfterMs - 1, cfg)).toBe(
      "live",
    );
    expect(livenessAt(source, baseNow + cfg.quietAfterMs, cfg)).toBe("quiet");
    expect(livenessAt(source, baseNow + cfg.staleAfterMs, cfg)).toBe("stale");
    expect(livenessAt(source, baseNow + cfg.lostAfterMs, cfg)).toBe("lost");
  });

  test("freshly-polled github Item is live even when the object is old", () => {
    const observedAt = iso(baseNow);
    const source = item({
      id: "github:pr:owner/repo#42",
      source: "github",
      project: "owner/repo",
      state: "needs_review",
      observedAt,
      staleAfter: nextStaleAfter("github", "needs_review", observedAt, cfg),
    });

    expect(source.staleAfter).toBe(iso(baseNow + cfg.pollGraceMs));
    expect(livenessAt(source, baseNow, cfg)).toBe("live");
  });

  test("done Item stays live even when staleAfter is far in the past", () => {
    const source = item({
      state: "done",
      liveness: "lost",
      staleAfter: iso(baseNow - 60 * 60 * 1000),
    });

    expect(livenessAt(source, baseNow, cfg)).toBe("live");
  });

  test("error is not terminal and can decay", () => {
    const source = item({
      state: "error",
      staleAfter: iso(baseNow - cfg.lostAfterMs),
    });

    expect(livenessAt(source, baseNow, cfg)).toBe("lost");
  });
});

describe("nextStaleAfter", () => {
  test("uses heartbeat grace for push sources and poll grace for github", () => {
    const observedAt = iso(baseNow);

    expect(nextStaleAfter("claude-code", "working", observedAt, cfg)).toBe(
      iso(baseNow + cfg.heartbeatGraceMs),
    );
    expect(nextStaleAfter("github", "working", observedAt, cfg)).toBe(
      iso(baseNow + cfg.pollGraceMs),
    );
  });

  test("done returns a far-future staleAfter", () => {
    expect(
      Date.parse(nextStaleAfter("codex", "done", iso(baseNow), cfg)),
    ).toBeGreaterThan(Date.parse("9998-01-01T00:00:00.000Z"));
  });
});

describe("LivenessTicker", () => {
  test("start emits updated copies only when liveness changes", () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const fakeTimer = 123 as unknown as ReturnType<typeof setInterval>;
    let callback: (() => void) | null = null;
    let cleared = false;
    let now = baseNow;
    let items = [
      item({ id: "claude-code:session:changed", staleAfter: iso(baseNow) }),
      item({
        id: "claude-code:session:unchanged",
        staleAfter: iso(baseNow + cfg.heartbeatGraceMs),
      }),
    ];
    const originalChanged = items[0];
    const changes: AttentionItem[] = [];

    globalThis.setInterval = ((handler: () => void) => {
      callback = handler;
      return fakeTimer;
    }) as typeof globalThis.setInterval;
    globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => {
      cleared = timer === fakeTimer;
    }) as typeof globalThis.clearInterval;

    try {
      const ticker = new LivenessTicker(
        () => items,
        (updated) => {
          changes.push(updated);
          items = items.map((current) =>
            current.id === updated.id ? updated : current,
          );
        },
        cfg,
        () => now,
      );

      ticker.start(1);
      expect(callback).not.toBeNull();

      callback?.();
      expect(changes).toHaveLength(0);

      now = baseNow + cfg.quietAfterMs;
      callback?.();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        id: "claude-code:session:changed",
        liveness: "quiet",
        state: "working",
      });
      expect(changes[0]).not.toBe(originalChanged);
      expect(originalChanged?.liveness).toBe("live");

      callback?.();
      expect(changes).toHaveLength(1);

      ticker.stop();
      expect(cleared).toBe(true);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("heartbeat refreshes matching claude-code staleAfter and returns it to live", () => {
    const stale = item({
      liveness: "lost",
      staleAfter: iso(baseNow - cfg.lostAfterMs),
    });
    const github = item({
      id: "github:pr:owner/repo#42",
      source: "github",
      staleAfter: iso(baseNow - cfg.lostAfterMs),
    });
    const ticker = new LivenessTicker(
      () => [],
      () => {},
      cfg,
      () => baseNow,
    );

    const refreshed = ticker.heartbeat("claude-code", [stale, github]);

    expect(refreshed[0]).not.toBe(stale);
    expect(refreshed[0]).toEqual({
      ...stale,
      liveness: "live",
      staleAfter: iso(baseNow + cfg.heartbeatGraceMs),
    });
    expect(stale).toMatchObject({
      liveness: "lost",
      staleAfter: iso(baseNow - cfg.lostAfterMs),
      state: "working",
    });
    expect(refreshed[1]).toBe(github);
  });
});
