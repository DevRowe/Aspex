import { describe, expect, test } from "bun:test";
import { signCursorBody } from "@aspex/adapter-cursor";
import type { ActionResult } from "@aspex/schema";
import errorFixture from "../../../packages/adapter-cursor/test/fixtures/error-status-change.json";
import finishedFixture from "../../../packages/adapter-cursor/test/fixtures/finished-status-change.json";
import { Bus } from "../src/bus";
import { enforceOwnership } from "../src/engine/attention";
import { type ServerDeps, buildApp } from "../src/http/server";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

const secret = "cursor-webhook-secret";

function openServer(cursorWebhook?: ServerDeps["cursorWebhook"]): {
  app: ReturnType<typeof buildApp>;
  db: ReturnType<typeof openDb>;
  worldModel: WorldModel;
} {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const worldModel = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,
    deriveLiveness: (item) => item,
  });
  const dispatchAction = async (): Promise<ActionResult> => ({
    ok: true,
    message: "dispatched",
  });
  const app = buildApp({
    worldModel,
    bus,
    cap: 7,
    version: "test",
    actionMeta: () => ({ requiresConfirmation: false }),
    dispatchAction,
    cursorWebhook,
  });

  return { app, db, worldModel };
}

describe("POST /webhooks/cursor", () => {
  test("is not mounted when cursor webhook deps are absent", async () => {
    const { app, db, worldModel } = openServer();

    const response = await app.fetch(signedCursorRequest(errorFixture, secret));

    expect(response.status).toBe(404);
    expect(worldModel.snapshot()).toEqual([]);
    db.close();
  });

  test("is not mounted when cursor webhook is disabled", async () => {
    const { app, db, worldModel } = openServer({ enabled: false, secret });

    const response = await app.fetch(signedCursorRequest(errorFixture, secret));

    expect(response.status).toBe(404);
    expect(worldModel.snapshot()).toEqual([]);
    db.close();
  });

  test("accepts a valid signed ERROR payload and applies an item", async () => {
    const { app, db, worldModel } = openServer({ enabled: true, secret });

    const response = await app.fetch(signedCursorRequest(errorFixture, secret));

    expect(response.status).toBe(202);
    expect(worldModel.snapshot()).toHaveLength(1);
    expect(worldModel.snapshot()[0]).toMatchObject({
      id: "cursor:agent:agent-error-1",
      source: "cursor",
      state: "error",
      reason: "errored",
      attentionRequired: true,
      deepLink: "cursor://agent/agent-error-1",
      actions: [],
    });
    db.close();
  });

  test("accepts a valid signed FINISHED payload as ambient done", async () => {
    const { app, db, worldModel } = openServer({ enabled: true, secret });

    const response = await app.fetch(
      signedCursorRequest(finishedFixture, secret),
    );

    expect(response.status).toBe(202);
    expect(worldModel.snapshot()[0]).toMatchObject({
      id: "cursor:agent:agent-finished-1",
      source: "cursor",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
    });
    db.close();
  });

  test("rejects missing or invalid signatures without applying an item", async () => {
    const { app, db, worldModel } = openServer({ enabled: true, secret });

    const missing = await app.fetch(
      new Request("http://hub.test/webhooks/cursor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(errorFixture),
      }),
    );
    const invalid = await app.fetch(
      signedCursorRequest(errorFixture, "wrong-secret"),
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(worldModel.snapshot()).toEqual([]);
    db.close();
  });

  test("fails closed when enabled without a configured secret", async () => {
    const { app, db, worldModel } = openServer({ enabled: true });

    const response = await app.fetch(signedCursorRequest(errorFixture, secret));

    expect(response.status).toBe(401);
    expect(worldModel.snapshot()).toEqual([]);
    db.close();
  });
});

function signedCursorRequest(payload: unknown, signingSecret: string): Request {
  const rawBody = JSON.stringify(payload);

  return new Request("http://hub.test/webhooks/cursor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cursor-signature": signCursorBody(rawBody, signingSecret),
    },
    body: rawBody,
  });
}
