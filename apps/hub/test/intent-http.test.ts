import { describe, expect, mock, test } from "bun:test";
import type {
  Action,
  ActionResult,
  IntentRequest,
  ItemId,
  VoiceContext,
} from "@aspex/schema";
import { Bus } from "../src/bus";
import { type ServerDeps, buildApp } from "../src/http/server";
import type { VoiceGateway, VoiceGatewayResult } from "../src/voice/gateway";
import {
  type GatewayDeps,
  VoiceGateway as RealVoiceGateway,
} from "../src/voice/gateway";
import {
  type IntentService,
  MockIntentService,
} from "../src/voice/intentService";
import { MockSttClient, type SttClient } from "../src/voice/sttClient";

const itemId: ItemId = "github:pr:brocorp/aspex#51";
const audio = new Uint8Array([5, 1]);
const context: VoiceContext = {
  selectedId: itemId,
  needsMeIds: [itemId],
};

describe("hub HTTP intent route", () => {
  test("POST /intent runs closed grammar without calling free-form intent", async () => {
    const resolve = mock(async (req: IntentRequest) => ({
      intent: {
        kind: "no_match" as const,
        heard: req.text,
        reason: "unknown_command" as const,
      },
      source: "freeform" as const,
    }));
    const { app } = openServer({
      voiceGateway: makeGateway([], {
        intentService: { resolve },
      }).gateway,
      intent: { enabled: true, mock: true },
    });

    const response = await app.fetch(
      jsonRequest("/intent", { text: "what needs me", context }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      readback: `Needs you: ${itemId}.`,
      directive: { type: "show_needs_me" },
      session: {},
    });
    expect(body.audio).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  test("POST /intent free-form arms, then confirm dispatches once", async () => {
    const mockService = new MockIntentService([
      { kind: "action", itemId, actionId: "approve" },
    ]);
    const resolve = mock((req: IntentRequest) => mockService.resolve(req));
    const { gateway, dispatchAction } = makeGateway([], {
      intentService: { resolve },
    });
    const { app } = openServer({
      voiceGateway: gateway,
      intent: { enabled: true, mock: true },
    });

    const armed = await app.fetch(
      jsonRequest("/intent", { text: "approve the atlas review", context }),
    );
    const armedBody = await armed.json();
    const confirmed = await app.fetch(
      jsonRequest("/intent", { text: "confirm approve", context }),
    );
    const confirmedBody = await confirmed.json();

    expect(armed.status).toBe(200);
    expect(armedBody.ok).toBe(true);
    expect(armedBody.readback).toContain("I read that as: approve");
    expect(armedBody.readback).toContain("confirm approve");
    expect(armedBody.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "approve",
    });
    expect(confirmed.status).toBe(200);
    expect(confirmedBody).toMatchObject({
      ok: true,
      readback: "Action done.",
      session: {},
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith(itemId, "approve", {
      confirmed: true,
    });
  });

  test("POST /intent converts raw gateway audio to cached audioUrl", async () => {
    const returnedAudio = new Uint8Array([9, 1, 9]);
    const { app } = openServer({
      intent: { enabled: true, mock: true },
      voiceGateway: fakeGateway(async () => ({
        ok: true,
        readback: "Done.",
        session: {},
        audio: returnedAudio,
      })),
    });

    const response = await app.fetch(
      jsonRequest("/intent", { text: "what needs me", context }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.audio).toBeUndefined();
    expect(body.audioUrl).toMatch(/^\/voice\/audio\//);

    const audioResponse = await app.fetch(
      new Request(`http://hub.test${body.audioUrl}`),
    );
    expect(audioResponse.status).toBe(200);
    expect(audioResponse.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await audioResponse.arrayBuffer())).toEqual(
      returnedAudio,
    );
  });

  test("POST /intent rejects missing and blank text", async () => {
    const { app } = openServer({
      voiceGateway: makeGateway([]).gateway,
      intent: { enabled: true, mock: true },
    });

    const missing = await app.fetch(jsonRequest("/intent", { context }));
    const blank = await app.fetch(
      jsonRequest("/intent", { text: "  ", context }),
    );

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "text required" });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "text required" });
  });

  test("POST /intent rejects bad context", async () => {
    const { app } = openServer({
      voiceGateway: makeGateway([]).gateway,
      intent: { enabled: true, mock: true },
    });

    const response = await app.fetch(
      jsonRequest("/intent", {
        text: "what needs me",
        context: { selectedId: 1 },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("message");
  });

  test("POST /intent returns 503 when intent is not configured", async () => {
    const { app } = openServer();

    const response = await app.fetch(
      jsonRequest("/intent", { text: "what needs me", context }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "intent not configured" });
  });

  test("POST /intent stays disabled when only voice has a gateway", async () => {
    const { app } = openServer({
      voiceGateway: makeGateway([]).gateway,
      voice: {
        enabled: true,
        pttKey: "Space",
        stt: "mock",
        tts: false,
      },
    });

    const response = await app.fetch(
      jsonRequest("/intent", { text: "what needs me", context }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "intent not configured" });
  });
});

describe("VoiceGateway text entrypoint", () => {
  test("handleText returns the same VoiceResult shape as handle", async () => {
    const viaAudio = makeGateway(["what needs me"]).gateway;
    const viaText = makeGateway([]).gateway;

    const audioResult = await viaAudio.handle(audio, "audio/webm", context);
    const textResult = await viaText.handleText("what needs me", context);

    expect(textResult).toEqual(audioResult);
  });

  test("handleText never calls STT", async () => {
    const stt: SttClient = {
      async transcribe() {
        throw new Error("STT should not be called");
      },
    };
    const { gateway } = makeGateway([], { stt });

    const result = await gateway.handleText("what needs me", context);

    expect(result.ok).toBe(true);
    expect(result.directive).toEqual({ type: "show_needs_me" });
  });
});

function openServer(overrides: Partial<ServerDeps> = {}) {
  const app = buildApp({
    worldModel: {} as ServerDeps["worldModel"],
    bus: new Bus(),
    cap: 7,
    version: "test",
    actionMeta: () => ({ requiresConfirmation: false }),
    dispatchAction: async () => ({ ok: true }),
    ...overrides,
  });

  return { app };
}

function makeGateway(
  transcripts: ConstructorParameters<typeof MockSttClient>[0],
  overrides: Partial<GatewayDeps> = {},
) {
  const dispatchAction = mock(
    async (): Promise<ActionResult> => ({ ok: true, message: "Action done." }),
  );
  const deps: GatewayDeps = {
    stt: new MockSttClient(transcripts),
    tts: null,
    dispatchAction,
    getSelectedActions: () => [action("approve"), action("merge")],
    resolveProject: () => null,
    snapshotNeedsMe: () => [itemId],
    readItem: (id) => `Read ${id}.`,
    confidenceThreshold: 0.8,
    confirmTtlMs: 30_000,
    now: () => Date.parse("2026-06-28T04:00:00.000Z"),
    snapshotCandidates: () => [
      {
        itemId,
        summary: "Atlas review is ready.",
        actions: ["approve", "merge"],
      },
    ],
    ...overrides,
  };

  return { gateway: new RealVoiceGateway(deps), dispatchAction };
}

function action(id: string, overrides: Partial<Action> = {}): Action {
  return {
    id,
    label: id,
    risk: "safe",
    requiresConfirmation: false,
    ...overrides,
  };
}

function fakeGateway(
  handleText: (
    text: string,
    context: VoiceContext,
  ) => Promise<VoiceGatewayResult>,
): VoiceGateway {
  return {
    handle: async () => ({
      ok: false,
      readback: "Unexpected voice call.",
      session: {},
    }),
    handleText,
  } as unknown as VoiceGateway;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://hub.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
