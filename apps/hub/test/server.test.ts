import { describe, expect, test } from "bun:test";
import type { ActionResult } from "@aspex/schema";
import { Bus } from "../src/bus";
import { enforceOwnership } from "../src/engine/attention";
import { type ServerDeps, buildApp } from "../src/http/server";
import { createStateStream } from "../src/http/sse";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

function openServer(
  overrides: Partial<Pick<ServerDeps, "actionMeta" | "dispatchAction">> = {},
) {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const worldModel = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,
    deriveLiveness: (item) => item,
  });
  const calls: Array<{ itemId: string; actionId: string; payload?: unknown }> =
    [];
  const dispatchAction =
    overrides.dispatchAction ??
    (async (itemId, actionId, payload): Promise<ActionResult> => {
      calls.push({ itemId, actionId, payload });
      return { ok: true, message: "dispatched" };
    });

  const app = buildApp({
    worldModel,
    bus,
    cap: 7,
    version: "test",
    actionMeta:
      overrides.actionMeta ??
      (() => ({
        requiresConfirmation: false,
      })),
    dispatchAction,
  });

  return { app, bus, calls, db, worldModel };
}

describe("hub HTTP server", () => {
  test("GET /health returns ok and version", async () => {
    const { app, db } = openServer();

    const response = await app.fetch(new Request("http://hub.test/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "test" });
    db.close();
  });

  test("POST /signals/:source accepts a Signal and /state includes the Item", async () => {
    const { app, db } = openServer();

    const ingest = await app.fetch(
      new Request("http://hub.test/signals/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "github:pr:owner/repo#42",
          source: "codex",
          project: "owner/repo",
          state: "needs_review",
          reason: "review_requested",
          attentionRequired: true,
          severity: "medium",
          summary: "Review requested",
        }),
      }),
    );
    const state = await app.fetch(new Request("http://hub.test/state"));
    const body = await state.json();

    expect(ingest.status).toBe(202);
    expect(body.needsMe).toHaveLength(1);
    expect(body.needsMe[0]).toMatchObject({
      id: "github:pr:owner/repo#42",
      source: "github",
      reason: "review_requested",
    });
    expect(body.overflow).toEqual([]);
    expect(typeof body.generatedAt).toBe("string");
    db.close();
  });

  test("POST /actions gates confirmation before dispatch", async () => {
    const { app, calls, db } = openServer({
      actionMeta: () => ({ requiresConfirmation: true }),
    });

    const blocked = await app.fetch(
      new Request(
        "http://hub.test/actions/github%3Apr%3Aowner%2Frepo%2342/merge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: { squash: true } }),
        },
      ),
    );
    const allowed = await app.fetch(
      new Request(
        "http://hub.test/actions/github%3Apr%3Aowner%2Frepo%2342/merge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            payload: { squash: true },
          }),
        },
      ),
    );

    expect(blocked.status).toBe(409);
    expect(calls).toEqual([
      {
        itemId: "github:pr:owner/repo#42",
        actionId: "merge",
        payload: { squash: true },
      },
    ]);
    expect(await allowed.json()).toEqual({ ok: true, message: "dispatched" });
    db.close();
  });

  test("POST /signals/:source rejects a bad Signal body", async () => {
    const { app, db } = openServer();

    const response = await app.fetch(
      new Request("http://hub.test/signals/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "github:pr:owner/repo#42" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid Signal" });
    db.close();
  });

  test("POST /actions rejects malformed JSON without dispatching", async () => {
    const { app, calls, db } = openServer();

    const response = await app.fetch(
      new Request("http://hub.test/actions/item-1/action-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("message");
    expect(calls).toEqual([]);
    db.close();
  });

  test("POST /actions decodes item and action URL params", async () => {
    const { app, calls, db } = openServer();

    const response = await app.fetch(
      new Request(
        "http://hub.test/actions/github%3Apr%3Aowner%2Frepo%2342/rerun%2Fcheck",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: { check: "ci" } }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        itemId: "github:pr:owner/repo#42",
        actionId: "rerun/check",
        payload: { check: "ci" },
      },
    ]);
    db.close();
  });

  test("CORS allows localhost and Tauri origins", async () => {
    const { app, db } = openServer();

    const localhost = await app.fetch(
      new Request("http://hub.test/health", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    const tauri = await app.fetch(
      new Request("http://hub.test/health", {
        headers: { Origin: "tauri://localhost" },
      }),
    );

    expect(localhost.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(tauri.headers.get("access-control-allow-origin")).toBe(
      "tauri://localhost",
    );
    db.close();
  });

  test("GET /stream sends initial state and world updates", async () => {
    const { app, db, worldModel } = openServer();
    const response = await app.fetch(new Request("http://hub.test/stream"));
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    const initial = await reader?.read();

    worldModel.applySignal({
      id: "codex:session:blocked",
      source: "codex",
      project: "aspex",
      state: "blocked",
      summary: "Codex needs input",
    });

    const update = await reader?.read();
    await reader?.cancel();

    expect(decode(initial?.value)).toContain("event: state\ndata:");
    expect(decode(update?.value)).toContain("codex:session:blocked");
    db.close();
  });

  test("state stream cleanup unsubscribes when cancelled", async () => {
    let unsubscribed = false;
    const stream = createStateStream({
      snapshot: () => ({ ok: true }),
      subscribe: () => () => {
        unsubscribed = true;
      },
    });
    const reader = stream.getReader();

    await reader.read();
    await reader.cancel();

    expect(unsubscribed).toBe(true);
  });
});

function decode(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}
