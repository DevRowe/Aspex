import { afterEach, describe, expect, test } from "bun:test";
import type { VoiceResult } from "@aspex/schema";
import { playReadback, postUtterance, stopReadback } from "./voiceClient";

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  stopReadback();
});

describe("voiceClient", () => {
  test("posts utterance audio and context as multipart form data", async () => {
    let request: Request | undefined;
    const result: VoiceResult = {
      ok: true,
      readback: "Showing what needs you.",
      session: {},
    };

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json(result));
    }) as typeof fetch;

    const response = await postUtterance(
      new Blob(["abc"], { type: "audio/webm" }),
      { selectedId: "github:pr:1", needsMeIds: ["github:pr:1"] },
    );

    expect(response).toEqual(result);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("http://127.0.0.1:4317/voice/utterance");

    const body = await request?.formData();
    expect((body?.get("audio") as File).name).toBe("utterance.webm");
    expect(body?.get("context")).toBe(
      JSON.stringify({
        selectedId: "github:pr:1",
        needsMeIds: ["github:pr:1"],
      }),
    );
  });

  test("stops existing readback when new readback starts", async () => {
    const pauses: number[] = [];

    class FakeAudio {
      currentTime = 4;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(readonly src: string) {}

      play() {
        return Promise.resolve();
      }

      pause() {
        pauses.push(this.currentTime);
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    URL.createObjectURL = () => "blob:readback";
    URL.revokeObjectURL = () => {};
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(new Blob(["wav"])),
      )) as unknown as typeof fetch;

    await playReadback({
      ok: true,
      readback: "one",
      audioUrl: "/voice/audio/one",
      session: {},
    });
    await playReadback({
      ok: true,
      readback: "two",
      audioUrl: "/voice/audio/two",
      session: {},
    });

    expect(pauses).toEqual([4]);
  });
});
