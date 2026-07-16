import { describe, expect, test } from "bun:test";
import type { ActionResult } from "@aspex/schema";
import { Bus } from "../src/bus";
import { enforceOwnership } from "../src/engine/attention";
import {
  type ServerDeps,
  buildApp,
  createHubBroadcaster,
} from "../src/http/server";
import {
  type SseBroadcaster,
  createSseBroadcaster,
  createStateStream,
} from "../src/http/sse";
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
  test("allows the voice session and generation headers in localhost CORS preflight", async () => {
    const { app, db } = openServer();

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "authorization, content-type, x-aspex-voice-session, x-aspex-voice-generation",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "X-Aspex-Voice-Generation",
    );
    db.close();
  });

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
    expect(blocked.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await blocked.json()).toMatchObject({
      type: "urn:aspex:problem:confirmation-required",
      status: 409,
      message: expect.stringContaining("confirmation"),
      itemId: "github:pr:owner/repo#42",
      actionId: "merge",
      summary: expect.stringContaining("merge"),
      resend: { payload: { squash: true }, confirmed: true },
    });
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
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      title: "Invalid Signal",
      status: 400,
      message: "Invalid Signal",
    });
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

    const initialText = decode(initial?.value);
    const initialId = sseId(initialText);
    expect(initialText).toContain("retry: ");
    expect(initialText).toContain(`id: ${initialId}\nevent: state\ndata:`);
    expect(decode(update?.value)).toContain(
      `id: ${initialId + 1}\nevent: state\ndata:`,
    );
    expect(decode(update?.value)).toContain("codex:session:blocked");
    db.close();
  });

  test("state stream cleanup unsubscribes when cancelled", async () => {
    let unsubscribed = false;
    const broadcaster = fakeBroadcaster({
      subscribe: () => () => {
        unsubscribed = true;
      },
    });
    const stream = createStateStream({
      snapshot: () => ({ ok: true }),
      broadcaster,
    });
    const reader = stream.getReader();

    await reader.read();
    await reader.cancel();

    expect(unsubscribed).toBe(true);
  });

  test("a frame sent to a dead stream is contained instead of thrown", async () => {
    let send: ((frame: string) => void) | undefined;
    const broadcaster = fakeBroadcaster({
      subscribe: (sendFrame) => {
        send = sendFrame;
        return () => {};
      },
    });
    const stream = createStateStream({
      snapshot: () => ({ ok: true }),
      broadcaster,
    });
    const reader = stream.getReader();

    await reader.read();
    await reader.cancel();

    // The bus emitter (and the ping timer) call this exact function; a dead
    // client throwing here would fail POST /signals and skip later listeners.
    expect(() => send?.("event: state\ndata: {}\n\n")).not.toThrow();
  });

  test("keepalives are a named ping event without an id", async () => {
    const stream = createStateStream({
      snapshot: () => ({ ok: true }),
      broadcaster: fakeBroadcaster({}),
      pingMs: 5,
    });
    const reader = stream.getReader();

    await reader.read();
    const ping = await reader.read();
    await reader.cancel();

    expect(decode(ping?.value)).toBe("event: ping\ndata: {}\n\n");
  });

  test("broadcaster assigns monotonic ids and replays from the ring", () => {
    const broadcaster = createSseBroadcaster({ bufferSize: 2 });
    const received: string[] = [];
    broadcaster.subscribe((frame) => received.push(frame));

    broadcaster.publish("state", { n: 1 });
    broadcaster.publish("state", { n: 2 });
    broadcaster.publish("state", { n: 3 });

    expect(received).toEqual([
      'id: 1\nevent: state\ndata: {"n":1}\n\n',
      'id: 2\nevent: state\ndata: {"n":2}\n\n',
      'id: 3\nevent: state\ndata: {"n":3}\n\n',
    ]);
    expect(broadcaster.lastEventId()).toBe(3);
    // Current client: nothing to replay.
    expect(broadcaster.replaySince(3)).toEqual([]);
    // One event behind, inside the ring.
    expect(broadcaster.replaySince(2)).toEqual([
      'id: 3\nevent: state\ndata: {"n":3}\n\n',
    ]);
    // id 1 was evicted (bufferSize 2), so resuming from 0 is impossible.
    expect(broadcaster.replaySince(0)).toBeNull();
    // A future id (previous Hub run) cannot be replayed either.
    expect(broadcaster.replaySince(99)).toBeNull();
  });

  test("broadcaster ids count up from the epoch and older ids cannot resume", () => {
    const broadcaster = createSseBroadcaster({ epoch: 1_000 });

    broadcaster.publish("state", { n: 1 });

    expect(broadcaster.lastEventId()).toBe(1_001);
    // An id from a run with an earlier epoch falls back to the snapshot.
    expect(broadcaster.replaySince(999)).toBeNull();
    expect(broadcaster.replaySince(1_000)).toEqual([
      'id: 1001\nevent: state\ndata: {"n":1}\n\n',
    ]);
  });

  test("GET /stream honors Last-Event-ID with replay, snapshot fallback when too old", async () => {
    const { app, db, worldModel } = openServer();

    worldModel.applySignal({
      id: "codex:session:one",
      source: "codex",
      project: "aspex",
      state: "blocked",
      summary: "First",
    });
    worldModel.applySignal({
      id: "codex:session:two",
      source: "codex",
      project: "aspex",
      state: "blocked",
      summary: "Second",
    });

    // Learn the current id from a fresh connect's stamped snapshot.
    const current = await app.fetch(new Request("http://hub.test/stream"));
    const currentReader = current.body?.getReader();
    const lastId = sseId(decode((await currentReader?.read())?.value));
    await currentReader?.cancel();

    // Reconnect that saw the previous id: gets only the missed frame.
    const resumed = await app.fetch(
      new Request("http://hub.test/stream", {
        headers: { "Last-Event-ID": `${lastId - 1}` },
      }),
    );
    const resumedReader = resumed.body?.getReader();
    const resumedChunk = decode((await resumedReader?.read())?.value);
    await resumedReader?.cancel();
    expect(resumedChunk).toContain("retry: ");
    expect(resumedChunk).toContain(`id: ${lastId}\nevent: state\ndata:`);
    expect(resumedChunk).not.toContain(`id: ${lastId - 1}\n`);

    // An id below the boot-time epoch (a previous Hub run): fresh snapshot
    // stamped with the current id.
    const stale = await app.fetch(
      new Request("http://hub.test/stream", {
        headers: { "Last-Event-ID": "999" },
      }),
    );
    const staleReader = stale.body?.getReader();
    const staleChunk = decode((await staleReader?.read())?.value);
    await staleReader?.cancel();
    expect(staleChunk).toContain(`id: ${lastId}\nevent: state\ndata:`);
    expect(staleChunk).toContain("codex:session:two");
    db.close();
  });

  test("a supplied broadcaster is shared across app rebuilds without double-publishing", () => {
    const db = openDb(":memory:");
    const bus = new Bus();
    const worldModel = new WorldModel(new ItemStore(db), bus, {
      deriveAttention: enforceOwnership,
      deriveLiveness: (item) => item,
    });
    const sseBroadcaster = createHubBroadcaster({ worldModel, bus, cap: 7 });
    const deps: ServerDeps = {
      worldModel,
      bus,
      cap: 7,
      version: "test",
      actionMeta: () => ({ requiresConfirmation: false }),
      dispatchAction: async () => ({ ok: true, message: "dispatched" }),
      sseBroadcaster,
    };

    buildApp(deps);
    buildApp(deps);

    const before = sseBroadcaster.lastEventId();
    worldModel.applySignal({
      id: "codex:session:rebuild",
      source: "codex",
      project: "aspex",
      state: "blocked",
      summary: "Rebuild",
    });

    expect(sseBroadcaster.lastEventId()).toBe(before + 1);
    db.close();
  });

  test("an unknown route answers problem+json 404", async () => {
    const { app, db } = openServer();

    const response = await app.fetch(new Request("http://hub.test/nope"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      message: "Not Found",
    });
    db.close();
  });

  test("an unhandled route error answers problem+json 500", async () => {
    const { app, db } = openServer({
      dispatchAction: async () => {
        throw new Error("adapter exploded");
      },
    });

    const response = await app.fetch(
      new Request("http://hub.test/actions/item-1/restart", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "Internal error",
      message: "Internal error",
    });
    db.close();
  });

  test("GET /state advertises the wire protocol version", async () => {
    const { app, db } = openServer();

    const body = await (
      await app.fetch(new Request("http://hub.test/state"))
    ).json();

    expect(body.apiVersion).toBe("1.1");
    db.close();
  });

  test("POST /actions accepts the Idempotency-Key header as the intent id", async () => {
    const { app, calls, db } = openServer();
    const request = () =>
      app.fetch(
        new Request("http://hub.test/actions/item-1/restart", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "key-1",
          },
          body: JSON.stringify({ payload: { a: 1 } }),
        }),
      );

    const first = await request();
    const second = await request();

    expect(first.status).toBe(200);
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({ intentId: "key-1" });
    db.close();
  });

  test("POST /actions rejects a header/body idempotency key disagreement", async () => {
    const { app, calls, db } = openServer();

    const response = await app.fetch(
      new Request("http://hub.test/actions/item-1/restart", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "key-a",
        },
        body: JSON.stringify({ intentId: "key-b" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: "urn:aspex:problem:idempotency-key-mismatch",
      status: 400,
      idempotencyKey: "key-a",
      intentId: "key-b",
    });
    expect(calls).toHaveLength(0);
    db.close();
  });

  test("POST /actions answers 422 for the same key with a different payload", async () => {
    const { app, calls, db } = openServer();
    const request = (payload: unknown) =>
      app.fetch(
        new Request("http://hub.test/actions/item-1/restart", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intentId: "key-2", payload }),
        }),
      );

    const first = await request({ a: 1 });
    const conflicting = await request({ a: 2 });

    expect(first.status).toBe(200);
    expect(conflicting.status).toBe(422);
    expect(conflicting.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await conflicting.json()).toMatchObject({
      type: "urn:aspex:problem:same-key-different-payload",
      status: 422,
      intentId: "key-2",
    });
    expect(calls).toHaveLength(1);
    db.close();
  });
});

function fakeBroadcaster(overrides: Partial<SseBroadcaster>): SseBroadcaster {
  return {
    publish: () => {},
    subscribe: () => () => {},
    lastEventId: () => 0,
    replaySince: () => null,
    ...overrides,
  };
}

function decode(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}

function sseId(frame: string): number {
  const match = /(?:^|\n)id: (\d+)\n/.exec(frame);

  if (match?.[1] === undefined) {
    throw new Error(`frame carries no id: ${frame}`);
  }

  return Number(match[1]);
}
