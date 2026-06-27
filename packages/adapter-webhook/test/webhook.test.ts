import { describe, expect, test } from "bun:test";
import { assertSignal } from "@aspex/schema";
import { buildHub } from "../../../apps/hub/src/boot";
import { DEFAULT_CONFIG } from "../../../apps/hub/src/config";
import { WebhookAdapter, normalizeWebhookBody } from "../src";

describe("webhook adapter", () => {
  test("minimal body normalizes to a valid Signal", () => {
    const signal = normalizeWebhookBody({
      key: "deploy-1",
      summary: "Deploy is running",
    });

    assertSignal(signal);
    expect(signal).toMatchObject({
      id: "webhook:deploy-1",
      source: "webhook",
      project: "webhook",
      state: "working",
      attentionRequired: false,
      severity: "info",
      summary: "Deploy is running",
      evidence: [],
      actions: [],
    });
  });

  test("attentionRequired defaults state to needs_review", () => {
    const signal = normalizeWebhookBody({
      key: "approval",
      summary: "Approval required",
      attentionRequired: true,
      severity: "high",
      evidence: [{ label: "Job", text: "deploy-prod" }],
    });

    expect(signal).toMatchObject({
      id: "webhook:approval",
      state: "needs_review",
      attentionRequired: true,
      severity: "high",
      evidence: [{ label: "Job", text: "deploy-prod" }],
    });
  });

  test("same key posted twice upserts one Item", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await postWebhook(hub.app, {
        key: "deploy-1",
        summary: "Deploy started",
      });
      await postWebhook(hub.app, {
        key: "deploy-1",
        summary: "Deploy still running",
      });

      const items = hub.world.snapshot();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: "webhook:deploy-1",
        summary: "Deploy still running",
      });
    } finally {
      await hub.stop();
    }
  });

  test("webhook route forces source and key-derived id", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await postWebhook(hub.app, {
        key: "deploy-1",
        id: "github:pr:owner/repo#1",
        source: "github",
        summary: "Deploy started",
      });

      expect(hub.world.snapshot()).toEqual([
        expect.objectContaining({
          id: "webhook:deploy-1",
          source: "webhook",
        }),
      ]);
    } finally {
      await hub.stop();
    }
  });

  test("attentionRequired body lands in needs-me", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await postWebhook(hub.app, {
        key: "approval",
        summary: "Manual approval required",
        attentionRequired: true,
      });

      const state = await stateSnapshot(hub.app);

      expect(state.needsMe).toHaveLength(1);
      expect(state.needsMe[0]).toMatchObject({
        id: "webhook:approval",
        source: "webhook",
        state: "needs_review",
        reason: "review_requested",
        attentionRequired: true,
      });
      expect(state.ambient).toHaveLength(0);
    } finally {
      await hub.stop();
    }
  });

  test("ambient body does not land in needs-me", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await postWebhook(hub.app, {
        key: "deploy-1",
        summary: "Deploy is running",
      });

      const state = await stateSnapshot(hub.app);

      expect(state.needsMe).toHaveLength(0);
      expect(state.ambient).toHaveLength(1);
      expect(state.ambient[0]).toMatchObject({
        id: "webhook:deploy-1",
        source: "webhook",
        state: "working",
        reason: "ambient",
        attentionRequired: false,
      });
    } finally {
      await hub.stop();
    }
  });

  test("adapter actions are read-only in Phase 0", async () => {
    const adapter = new WebhookAdapter();

    expect(adapter.listActions("webhook:deploy-1")).toEqual([]);
    await expect(adapter.runAction("webhook:deploy-1", "ack")).resolves.toEqual(
      {
        ok: false,
        message: "read-only in Phase 0",
      },
    );
  });
});

interface TestApp {
  fetch(request: Request): Response | Promise<Response>;
}

async function postWebhook(app: TestApp, body: unknown) {
  const response = await app.fetch(
    new Request("http://hub.test/signals/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  expect(response.status).toBe(202);
}

async function stateSnapshot(app: TestApp): Promise<{
  needsMe: unknown[];
  ambient: unknown[];
}> {
  const response = await app.fetch(new Request("http://hub.test/state"));

  expect(response.status).toBe(200);
  return response.json();
}
