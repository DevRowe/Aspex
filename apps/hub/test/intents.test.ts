import { describe, expect, test } from "bun:test";
import type {
  Action,
  ActionResult,
  DispatchIntent,
  Orchestrator,
  StatusQueryIntent,
} from "@aspex/schema";
import { OrchestratorRegistry } from "../src/adapters/orchestrators";
import { Bus } from "../src/bus";
import { enforceOwnership } from "../src/engine/attention";
import { LivenessTicker } from "../src/engine/liveness";
import { IntentLedger } from "../src/http/intentLedger";
import { type ServerDeps, buildApp } from "../src/http/server";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";
import { WorldModel } from "../src/world/worldModel";

const SHIP_ACTION: Action = {
  id: "ship",
  label: "Review & ship",
  risk: "dangerous",
  requiresConfirmation: true,
};

class FakeOrchestrator implements Orchestrator {
  id = "giles";
  runActionCalls: { itemId: string; actionId: string; payload?: unknown }[] =
    [];
  dispatchCalls: DispatchIntent[] = [];
  queryCalls: StatusQueryIntent[] = [];
  nextResult: ActionResult = { ok: true, message: "queued" };

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  listActions(itemId: string): Action[] {
    return itemId.endsWith("known-task") ? [SHIP_ACTION] : [];
  }

  async runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    this.runActionCalls.push({ itemId, actionId, payload });
    return this.nextResult;
  }

  async dispatch(intent: DispatchIntent) {
    this.dispatchCalls.push(intent);
    return { ok: true, message: "dispatched" };
  }

  async query(intent: StatusQueryIntent) {
    this.queryCalls.push(intent);
    return { ok: true, text: `giles detail for ${intent.scope}` };
  }
}

function openIntentsServer() {
  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new ItemStore(db);
  const worldModel = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,
    deriveLiveness: (item) => item,
  });
  const liveness = new LivenessTicker(
    () => store.getAll(),
    () => {},
    {
      pollGraceMs: 90_000,
      heartbeatGraceMs: 120_000,
      quietAfterMs: 30_000,
      staleAfterMs: 90_000,
      lostAfterMs: 180_000,
    },
  );
  const orchestrators = new OrchestratorRegistry(worldModel, liveness);
  const orchestrator = new FakeOrchestrator();
  orchestrators.register(orchestrator);

  const deps: ServerDeps = {
    worldModel,
    bus,
    cap: 7,
    version: "test",
    dispatchAction: (itemId, actionId, payload) =>
      orchestrators.dispatchAction(itemId, actionId, payload),
    actionMeta: (itemId, actionId) =>
      orchestrators.actionMeta(itemId, actionId),
    intents: {
      dispatch: (intent) => orchestrators.dispatch(intent),
      query: (intent) => orchestrators.query(intent),
    },
    intentLedger: new IntentLedger(),
  };
  const app = buildApp(deps);

  return { app, db, orchestrator, orchestrators };
}

const post = (
  app: ReturnType<typeof openIntentsServer>["app"],
  path: string,
  body: unknown,
) =>
  app.fetch(
    new Request(`http://hub.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /intents", () => {
  test("rejects invalid intent payloads", async () => {
    const { app, db } = openIntentsServer();

    const response = await post(app, "/intents", { verb: "dispatch" });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      title: "Invalid DirectionIntent",
      status: 400,
      message: "Invalid DirectionIntent",
    });
    db.close();
  });

  test("refuses an unconfirmed dispatch with the existing 409 contract", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, "/intents", {
      verb: "dispatch",
      intentId: "d-1",
      orchestrator: "giles",
      instruction: "Add a settings screen.",
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "urn:aspex:problem:confirmation-required",
      title: "Action requires confirmation",
      status: 409,
      message: expect.stringContaining("confirmation"),
      verb: "dispatch",
      intentId: "d-1",
      orchestrator: "giles",
      summary: expect.stringContaining("Add a settings screen."),
      resend: {
        verb: "dispatch",
        intentId: "d-1",
        orchestrator: "giles",
        instruction: "Add a settings screen.",
        confirmed: true,
      },
    });
    expect(orchestrator.dispatchCalls).toHaveLength(0);
    db.close();
  });

  test("delivers a confirmed dispatch and returns 202", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, "/intents", {
      verb: "dispatch",
      intentId: "d-2",
      orchestrator: "giles",
      project: "numbat",
      instruction: "Add a settings screen.",
      confirmed: true,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(orchestrator.dispatchCalls).toHaveLength(1);
    expect(orchestrator.dispatchCalls[0]).toMatchObject({
      intentId: "d-2",
      project: "numbat",
    });
    db.close();
  });

  test("a retried dispatch intentId returns the cached ack without re-dispatching", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    const intent = {
      verb: "dispatch",
      intentId: "d-3",
      orchestrator: "giles",
      instruction: "Do it once.",
      confirmed: true,
    };

    const first = await post(app, "/intents", intent);
    const second = await post(app, "/intents", intent);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(orchestrator.dispatchCalls).toHaveLength(1);
    db.close();
  });

  test("two concurrent dispatches with the same intentId deliver once", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = orchestrator.dispatch.bind(orchestrator);
    orchestrator.dispatch = async (intent) => {
      await gate;
      return dispatch(intent);
    };
    const intent = {
      verb: "dispatch",
      intentId: "d-9",
      orchestrator: "giles",
      instruction: "Do it once.",
      confirmed: true,
    };

    const first = post(app, "/intents", intent);
    const second = post(app, "/intents", intent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(await secondResponse.json()).toEqual(await firstResponse.json());
    expect(orchestrator.dispatchCalls).toHaveLength(1);
    db.close();
  });

  test("dispatch to an unknown orchestrator is a delivery failure", async () => {
    const { app, db } = openIntentsServer();

    const response = await post(app, "/intents", {
      verb: "dispatch",
      intentId: "d-4",
      orchestrator: "nope",
      instruction: "Whatever.",
      confirmed: true,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false });
    db.close();
  });

  test("status queries are safe: no confirmation, answered with 200", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, "/intents", {
      verb: "status_query",
      intentId: "q-1",
      scope: "orchestrator:giles:known-task",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      text: "giles detail for orchestrator:giles:known-task",
    });
    expect(orchestrator.queryCalls).toHaveLength(1);
    db.close();
  });

  test("the route is absent when no intents dep is wired", async () => {
    const { app, db } = openIntentsServer();
    const bare = buildApp({
      worldModel: new WorldModel(new ItemStore(openDb(":memory:")), new Bus(), {
        deriveAttention: (i) => i,
        deriveLiveness: (i) => i,
      }),
      bus: new Bus(),
      cap: 7,
      version: "test",
      dispatchAction: async () => ({ ok: true }),
      actionMeta: () => null,
    });

    const response = await bare.fetch(
      new Request("http://hub.test/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verb: "status_query", intentId: "q-9" }),
      }),
    );

    expect(response.status).toBe(404);
    void app;
    db.close();
  });
});

describe("POST /actions idempotency (intentId)", () => {
  const URL_PATH = "/actions/orchestrator%3Agiles%3Aknown-task/ship";

  test("rejects malformed intentIds", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, URL_PATH, {
      confirmed: true,
      intentId: "../../escape",
    });

    expect(response.status).toBe(400);
    expect(orchestrator.runActionCalls).toHaveLength(0);
    db.close();
  });

  test("rejects a non-object payload sent with an intentId", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, URL_PATH, {
      confirmed: true,
      intentId: "a-0",
      payload: "ship it",
    });

    expect(response.status).toBe(400);
    expect(orchestrator.runActionCalls).toHaveLength(0);
    db.close();
  });

  test("threads the intentId into the payload for the orchestrator", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, URL_PATH, {
      confirmed: true,
      intentId: "a-1",
      payload: { text: "ship it" },
    });

    expect(response.status).toBe(200);
    expect(orchestrator.runActionCalls).toHaveLength(1);
    expect(orchestrator.runActionCalls[0]).toEqual({
      itemId: "orchestrator:giles:known-task",
      actionId: "ship",
      payload: { text: "ship it", intentId: "a-1" },
    });
    db.close();
  });

  test("a retried action intentId returns the cached result without re-running", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    const body = { confirmed: true, intentId: "a-2", payload: { text: "go" } };

    const first = await post(app, URL_PATH, body);
    const second = await post(app, URL_PATH, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(orchestrator.runActionCalls).toHaveLength(1);
    db.close();
  });

  test("two concurrent requests with the same intentId dispatch once", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runAction = orchestrator.runAction.bind(orchestrator);
    orchestrator.runAction = async (itemId, actionId, payload) => {
      await gate;
      return runAction(itemId, actionId, payload);
    };
    const body = { confirmed: true, intentId: "a-5", payload: { text: "go" } };

    // Both requests are in flight before the first dispatch resolves - the
    // exact concurrent-retry race the in-flight ledger entry closes.
    const first = post(app, URL_PATH, body);
    const second = post(app, URL_PATH, body);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual(await firstResponse.json());
    expect(orchestrator.runActionCalls).toHaveLength(1);
    db.close();
  });

  test("failures are not cached, so a retry can succeed", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    orchestrator.nextResult = { ok: false, message: "transient" };

    await post(app, URL_PATH, { confirmed: true, intentId: "a-3" });
    orchestrator.nextResult = { ok: true, message: "queued" };
    const retry = await post(app, URL_PATH, {
      confirmed: true,
      intentId: "a-3",
    });

    expect(await retry.json()).toMatchObject({ ok: true });
    expect(orchestrator.runActionCalls).toHaveLength(2);
    db.close();
  });

  test("still enforces the confirmation gate before delivery", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const response = await post(app, URL_PATH, { intentId: "a-4" });

    expect(response.status).toBe(409);
    expect(orchestrator.runActionCalls).toHaveLength(0);
    db.close();
  });
});

describe("OrchestratorRegistry routing", () => {
  test("routes orchestrator items by their kind segment and validates actions", async () => {
    const { db, orchestrator, orchestrators } = openIntentsServer();

    expect(orchestrators.ownsItem("orchestrator:giles:known-task")).toBe(true);
    expect(orchestrators.ownsItem("github:pr:o/r#42")).toBe(false);

    const unknownAction = await orchestrators.dispatchAction(
      "orchestrator:giles:known-task",
      "merge",
    );
    expect(unknownAction).toEqual({ ok: false, message: "Unknown action" });

    const unknownOrchestrator = await orchestrators.dispatchAction(
      "orchestrator:other:known-task",
      "ship",
    );
    expect(unknownOrchestrator.ok).toBe(false);

    const routed = await orchestrators.dispatchAction(
      "orchestrator:giles:known-task",
      "ship",
      { text: "go" },
    );
    expect(routed.ok).toBe(true);
    expect(orchestrator.runActionCalls).toHaveLength(1);

    expect(
      orchestrators.actionMeta("orchestrator:giles:known-task", "ship"),
    ).toEqual({ requiresConfirmation: true, label: "Review & ship" });
    expect(
      orchestrators.actionMeta("orchestrator:giles:known-task", "nope"),
    ).toBeNull();
    db.close();
  });
});

describe("IntentLedger", () => {
  test("evicts the least recently used entry beyond capacity", () => {
    const ledger = new IntentLedger(2);
    ledger.record("a", { status: 200, body: 1 }, "fp-a");
    ledger.record("b", { status: 200, body: 2 }, "fp-b");
    expect(ledger.get("a")?.entry.body).toBe(1);

    ledger.record("c", { status: 200, body: 3 }, "fp-c");

    expect(ledger.get("b")).toBeNull();
    expect(ledger.get("a")?.entry.body).toBe(1);
    expect(ledger.get("c")?.entry.body).toBe(3);
  });

  test("a replayed dispatch is marked with Idempotency-Replayed", async () => {
    const { app, db, orchestrator } = openIntentsServer();
    const intent = {
      verb: "dispatch",
      intentId: "d-8",
      orchestrator: "giles",
      instruction: "Once only.",
      confirmed: true,
    };

    const first = await post(app, "/intents", intent);
    const second = await post(app, "/intents", intent);

    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(orchestrator.dispatchCalls).toHaveLength(1);
    db.close();
  });

  test("the same dispatch intentId with a different instruction is a 422 conflict", async () => {
    const { app, db, orchestrator } = openIntentsServer();

    const first = await post(app, "/intents", {
      verb: "dispatch",
      intentId: "d-7",
      orchestrator: "giles",
      instruction: "Original instruction.",
      confirmed: true,
    });
    const conflicting = await post(app, "/intents", {
      verb: "dispatch",
      intentId: "d-7",
      orchestrator: "giles",
      instruction: "Different instruction.",
      confirmed: true,
    });

    expect(first.status).toBe(202);
    expect(conflicting.status).toBe(422);
    expect(await conflicting.json()).toMatchObject({
      type: "urn:aspex:problem:same-key-different-payload",
      status: 422,
      intentId: "d-7",
    });
    expect(orchestrator.dispatchCalls).toHaveLength(1);
    db.close();
  });
});
