import { afterEach, describe, expect, test } from "bun:test";
import type { Transcript } from "@aspex/schema";
import {
  HttpSttClient,
  MockSttClient,
  VoiceServiceError,
} from "../src/voice/sttClient";
import { HttpTtsClient, MockTtsClient } from "../src/voice/ttsClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HttpSttClient", () => {
  test("falls back to the second endpoint in order", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response("nope", { status: 500 });
      }

      return Response.json({ text: "approve", confidence: 0.91 });
    };

    const client = new HttpSttClient({
      endpoints: ["http://stt-one/transcribe", "http://stt-two/transcribe"],
      timeoutMs: 100,
    });

    await expect(
      client.transcribe(new Uint8Array([1, 2, 3]), "audio/webm"),
    ).resolves.toEqual({ text: "approve", confidence: 0.91 });
    expect(calls).toEqual([
      "http://stt-one/transcribe",
      "http://stt-two/transcribe",
    ]);
  });

  test("throws VoiceServiceError when all endpoints fail", async () => {
    globalThis.fetch = async () => new Response("broken", { status: 503 });
    const client = new HttpSttClient({
      endpoints: ["http://stt-one/transcribe", "http://stt-two/transcribe"],
      timeoutMs: 100,
    });

    await expect(
      client.transcribe(new Uint8Array([1]), "audio/webm"),
    ).rejects.toBeInstanceOf(VoiceServiceError);
  });

  test("aborts a timed-out endpoint and moves on", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Promise<Response>(() => {});
      }

      return Response.json({ text: "read it", confidence: 0.86 });
    };

    const client = new HttpSttClient({
      endpoints: ["http://slow/transcribe", "http://fast/transcribe"],
      timeoutMs: 1,
    });

    await expect(
      client.transcribe(new Uint8Array([1]), "audio/webm"),
    ).resolves.toEqual({ text: "read it", confidence: 0.86 });
    expect(calls).toEqual(["http://slow/transcribe", "http://fast/transcribe"]);
  });

  test("rejects invalid transcript shapes including confidence outside 0..1", async () => {
    globalThis.fetch = async () =>
      Response.json({ text: "approve", confidence: 1.01 });
    const client = new HttpSttClient({
      endpoints: ["http://stt/transcribe"],
      timeoutMs: 100,
    });

    await expect(
      client.transcribe(new Uint8Array([1]), "audio/webm"),
    ).rejects.toBeInstanceOf(VoiceServiceError);
  });
});

describe("HttpTtsClient", () => {
  test("returns null instead of throwing on a failing endpoint", async () => {
    globalThis.fetch = async () => {
      throw new Error("tts unavailable");
    };
    const client = new HttpTtsClient({
      endpoint: "http://tts/speak",
      timeoutMs: 100,
    });

    await expect(client.speak("hello")).resolves.toBeNull();
  });
});

describe("MockTtsClient", () => {
  test("returns silent wav bytes or null when disabled", async () => {
    await expect(new MockTtsClient().speak("hello")).resolves.toBeInstanceOf(
      Uint8Array,
    );
    await expect(
      new MockTtsClient({ disabled: true }).speak("hello"),
    ).resolves.toBeNull();
  });
});

describe("MockSttClient", () => {
  test("returns scripted text transcripts then the default", async () => {
    const client = new MockSttClient(["approve"]);

    await expect(
      client.transcribe(new Uint8Array(), "audio/webm"),
    ).resolves.toEqual({ text: "approve", confidence: 1 });
    await expect(
      client.transcribe(new Uint8Array(), "audio/webm"),
    ).resolves.toEqual({ text: "", confidence: 1 });
  });

  test("preserves scripted transcript objects", async () => {
    const scripted: Transcript = { text: "approve", confidence: 0.99 };
    const client = new MockSttClient([scripted]);

    await expect(
      client.transcribe(new Uint8Array(), "audio/webm"),
    ).resolves.toBe(scripted);
    await expect(
      client.transcribe(new Uint8Array(), "audio/webm"),
    ).resolves.toEqual({ text: "", confidence: 1 });
  });
});
