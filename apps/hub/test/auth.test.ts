import { describe, expect, test } from "bun:test";
import { signCursorBody } from "@aspex/adapter-cursor";
import type { ActionResult } from "@aspex/schema";
import { Bus } from "../src/bus";
import { DEFAULT_CONFIG } from "../src/config";
import { enforceOwnership } from "../src/engine/attention";
import { generateHubToken, timingSafeEqualToken } from "../src/http/auth";
import { type ServerDeps, buildApp } from "../src/http/server";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

const TOKEN = "test-token-abc123";

function openAuthedServer(overrides: Partial<ServerDeps> = {}) {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const worldModel = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,
    deriveLiveness: (item) => item,
  });

  const app = buildApp({
    worldModel,
    bus,
    cap: 7,
    version: "test",
    authToken: TOKEN,
    dispatchAction: async (): Promise<ActionResult> => ({
      ok: true,
      message: "dispatched",
    }),
    actionMeta: () => ({ requiresConfirmation: false }),
    cursorWebhook: { enabled: true, secret: "cursor-secret" },
    ...overrides,
  });

  return { app, bus, db, worldModel };
}

describe("hub API auth", () => {
  test("rejects requests with no token", async () => {
    const { app, db } = openAuthedServer();

    const response = await app.fetch(new Request("http://hub.test/state"));

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      title: "Unauthorized",
      status: 401,
      message: "Unauthorized",
    });
    db.close();
  });

  test("rejects requests with the wrong token", async () => {
    const { app, db } = openAuthedServer();

    const response = await app.fetch(
      new Request("http://hub.test/state", {
        headers: { authorization: "Bearer not-the-token" },
      }),
    );

    expect(response.status).toBe(401);
    db.close();
  });

  test("accepts a correct bearer header", async () => {
    const { app, db } = openAuthedServer();

    const response = await app.fetch(
      new Request("http://hub.test/health", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "test" });
    db.close();
  });

  test("accepts the token as a query parameter for the SSE stream", async () => {
    const { app, db } = openAuthedServer();

    const rejected = await app.fetch(new Request("http://hub.test/stream"));
    const accepted = await app.fetch(
      new Request(`http://hub.test/stream?token=${TOKEN}`),
    );
    await accepted.body?.cancel();

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("content-type")).toContain("text/event-stream");
    db.close();
  });

  test("rejects query tokens outside the SSE stream", async () => {
    const { app, db } = openAuthedServer();

    const response = await app.fetch(
      new Request(`http://hub.test/state?token=${TOKEN}`),
    );

    expect(response.status).toBe(401);
    db.close();
  });

  test("protects action dispatch", async () => {
    const { app, db } = openAuthedServer();

    const url =
      "http://hub.test/actions/github%3Apr%3Aowner%2Frepo%2342/approve";
    const blocked = await app.fetch(new Request(url, { method: "POST" }));
    const allowed = await app.fetch(
      new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(blocked.status).toBe(401);
    expect(allowed.status).toBe(200);
    db.close();
  });

  test("exempts the cursor webhook, which authenticates by HMAC", async () => {
    const { app, db, worldModel } = openAuthedServer();
    const rawBody = JSON.stringify({
      statusChange: "ERROR",
      agentId: "abc",
      project: "aspex",
    });

    const response = await app.fetch(
      new Request("http://hub.test/webhooks/cursor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cursor-signature": signCursorBody(rawBody, "cursor-secret"),
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(202);
    expect(worldModel.snapshot()[0]).toMatchObject({ id: "cursor:agent:abc" });
    db.close();
  });

  test("allows CORS preflight without a token", async () => {
    const { app, db } = openAuthedServer();

    const response = await app.fetch(
      new Request("http://hub.test/state", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization,Content-Type,Idempotency-Key,X-Aspex-Voice-Session,X-Aspex-Voice-Generation",
    );
    db.close();
  });

  test("allows the one configured extra CORS origin and no others", async () => {
    const { app, db } = openAuthedServer({
      corsOrigin: "http://hl2.tailnet:8080",
    });

    const preflight = (origin: string) =>
      app.fetch(
        new Request("http://hub.test/state", {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "GET",
          },
        }),
      );

    const allowed = await preflight("http://hl2.tailnet:8080");
    const denied = await preflight("http://evil.example");

    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://hl2.tailnet:8080",
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    db.close();
  });

  test("no token configured leaves endpoints open (test/dev seam)", async () => {
    const { app, db } = openAuthedServer({ authToken: undefined });

    const response = await app.fetch(new Request("http://hub.test/health"));

    expect(response.status).toBe(200);
    db.close();
  });
});

describe("hub token primitives", () => {
  test("generateHubToken returns a fresh high-entropy token each call", () => {
    const a = generateHubToken();
    const b = generateHubToken();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("timingSafeEqualToken compares by value and length", () => {
    expect(timingSafeEqualToken("same-token", "same-token")).toBe(true);
    expect(timingSafeEqualToken("token", "different")).toBe(false);
    expect(timingSafeEqualToken("short", "short-but-longer")).toBe(false);
  });

  test("DEFAULT_CONFIG ships without a hardcoded token", () => {
    expect(DEFAULT_CONFIG.auth).toBeUndefined();
  });
});
