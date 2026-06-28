import { describe, expect, test } from "bun:test";
import type { VoiceContext, VoiceResult } from "@aspex/schema";
import { Bus } from "../src/bus";
import { type ServerDeps, buildApp } from "../src/http/server";
import type { VoiceGateway, VoiceGatewayResult } from "../src/voice/gateway";

const audioBytes = new Uint8Array([1, 3, 5, 8]);
const context: VoiceContext = {
  selectedId: "github:pr:brocorp/aspex#28",
  needsMeIds: ["github:pr:brocorp/aspex#28"],
};

describe("hub HTTP voice routes", () => {
  test("POST /voice/utterance returns audioUrl and cached WAV bytes", async () => {
    const returnedAudio = new Uint8Array([9, 7, 5, 3]);
    const { app, calls } = openServer({
      voiceGateway: fakeGateway(async (audio, mime, voiceContext) => {
        calls.push({ audio, mime, context: voiceContext });
        return {
          ok: true,
          readback: "Done.",
          session: {},
          audio: returnedAudio,
        };
      }),
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: utteranceForm(),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        audio: audioBytes,
        mime: "audio/x-wav",
        context,
      },
    ]);
    expect(body).toMatchObject({
      ok: true,
      readback: "Done.",
      session: {},
    });
    expect(body.audio).toBeUndefined();
    expect(body.audioUrl).toMatch(/^\/voice\/audio\//);

    const audio = await app.fetch(
      new Request(`http://hub.test${body.audioUrl}`),
    );

    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(returnedAudio);
  });

  test("POST /voice/utterance omits audioUrl when gateway returns no audio", async () => {
    const { app } = openServer({
      voiceGateway: fakeGateway(async () => ({
        ok: true,
        readback: "No speech.",
        session: {},
        audioUrl: "/voice/audio/stale",
      })),
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: utteranceForm(),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      readback: "No speech.",
      session: {},
    });
  });

  test("POST /voice/utterance rejects missing context", async () => {
    const form = new FormData();
    form.set("audio", audioBlob(), "utterance.webm");
    const { app } = openServer({
      voiceGateway: fakeGateway(async () => voiceResult()),
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("message");
  });

  test("POST /voice/utterance rejects bad context", async () => {
    const { app } = openServer({
      voiceGateway: fakeGateway(async () => voiceResult()),
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: utteranceForm({ contextJson: JSON.stringify({ selectedId: 1 }) }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("message");
  });

  test("POST /voice/utterance rejects missing audio", async () => {
    const form = new FormData();
    form.set("context", JSON.stringify(context));
    const { app } = openServer({
      voiceGateway: fakeGateway(async () => voiceResult()),
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Missing audio" });
  });

  test("POST /voice/utterance returns 503 when voice gateway is not configured", async () => {
    const { app } = openServer();

    const response = await app.fetch(
      new Request("http://hub.test/voice/utterance", {
        method: "POST",
        body: utteranceForm(),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "voice not configured" });
  });

  test("GET /voice/health returns configured shape", async () => {
    const { app } = openServer({
      voiceGateway: fakeGateway(async () => voiceResult()),
      voice: {
        enabled: true,
        pttKey: "Space",
        stt: "mock",
        tts: true,
      },
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/health"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stt: "mock",
      tts: true,
    });
  });

  test("GET /voice/config returns client-facing voice config", async () => {
    const { app } = openServer({
      voice: {
        enabled: true,
        pttKey: "KeyV",
        stt: "http",
        tts: false,
      },
    });

    const response = await app.fetch(
      new Request("http://hub.test/voice/config"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      pttKey: "KeyV",
    });
  });
});

function openServer(overrides: Partial<ServerDeps> = {}) {
  const calls: Array<{
    audio: Uint8Array;
    mime: string;
    context: VoiceContext;
  }> = [];
  const app = buildApp({
    worldModel: {} as ServerDeps["worldModel"],
    bus: new Bus(),
    cap: 7,
    version: "test",
    actionMeta: () => ({ requiresConfirmation: false }),
    dispatchAction: async () => ({ ok: true }),
    ...overrides,
  });

  return { app, calls };
}

function utteranceForm(options: { contextJson?: string } = {}): FormData {
  const form = new FormData();
  form.set("audio", audioBlob(), "utterance.wav");
  form.set("context", options.contextJson ?? JSON.stringify(context));
  return form;
}

function audioBlob(): Blob {
  return new File([audioBytes], "utterance.wav", { type: "audio/wav" });
}

function fakeGateway(
  handle: (
    audio: Uint8Array,
    mime: string,
    context: VoiceContext,
  ) => Promise<VoiceGatewayResult>,
): VoiceGateway {
  return { handle } as unknown as VoiceGateway;
}

function voiceResult(): VoiceResult {
  return {
    ok: true,
    readback: "Done.",
    session: {},
  };
}
