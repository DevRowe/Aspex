import { describe, expect, test } from "bun:test";
import type { AttentionItem } from "@aspex/schema";
import { Bus } from "../../../apps/hub/src/bus";
import { type FetchFn, NtfyNotifier } from "../src";

describe("ntfy notifier", () => {
  test("high severity item becoming attentionRequired publishes once", async () => {
    const calls: FetchCall[] = [];
    const bus = new Bus();
    new NtfyNotifier({ server: "https://ntfy.example", topic: "aspex" }, bus, {
      fetch: fetchMock(calls),
    });

    bus.emit("world:changed", { upserted: [item()], removed: [] });
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "https://ntfy.example/aspex",
      init: expect.objectContaining({
        method: "POST",
        body: "Review requested on brocorp/aspex#18",
        headers: expect.objectContaining({
          Title: "Review requested",
          Priority: "4",
          Click: "https://github.com/brocorp/aspex/pull/18",
        }),
      }),
    });
  });

  test("same item updated while still attentionRequired does not publish again", async () => {
    const calls: FetchCall[] = [];
    const bus = new Bus();
    new NtfyNotifier({ server: "https://ntfy.example", topic: "aspex" }, bus, {
      fetch: fetchMock(calls),
    });

    bus.emit("world:changed", { upserted: [item()], removed: [] });
    await tick();
    bus.emit("world:changed", {
      upserted: [item({ summary: "Still waiting for review" })],
      removed: [],
    });
    await tick();

    expect(calls).toHaveLength(1);
  });

  test("medium severity item does not publish when minSeverity is high", async () => {
    const calls: FetchCall[] = [];
    const bus = new Bus();
    new NtfyNotifier(
      { server: "https://ntfy.example", topic: "aspex", minSeverity: "high" },
      bus,
      { fetch: fetchMock(calls) },
    );

    bus.emit("world:changed", {
      upserted: [item({ severity: "medium" })],
      removed: [],
    });
    await tick();

    expect(calls).toHaveLength(0);
  });

  test("ntfy HTTP failure is logged and swallowed", async () => {
    const logs: string[] = [];
    const bus = new Bus();
    new NtfyNotifier({ server: "https://ntfy.example", topic: "aspex" }, bus, {
      fetch: async () => new Response("nope", { status: 503 }),
      log: (message) => logs.push(message),
    });

    expect(() => {
      bus.emit("world:changed", { upserted: [item()], removed: [] });
    }).not.toThrow();
    await tick();

    expect(logs).toEqual([
      "ntfy publish failed for github:pr:brocorp/aspex#18: 503 ",
    ]);
  });
});

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function fetchMock(calls: FetchCall[]): FetchFn {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
}

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "github:pr:brocorp/aspex#18",
    source: "github",
    project: "brocorp/aspex",
    state: "needs_review",
    liveness: "live",
    reason: "review_requested",
    attentionRequired: true,
    severity: "high",
    summary: "Review requested on brocorp/aspex#18",
    evidence: [],
    actions: [],
    deepLink: "https://github.com/brocorp/aspex/pull/18",
    observedAt: "2026-06-28T00:00:00.000Z",
    staleAfter: "2026-06-28T00:02:00.000Z",
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
