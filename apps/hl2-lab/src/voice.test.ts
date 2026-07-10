import { describe, expect, test } from "bun:test";
import { type Capture, MicrophoneCapture, VoiceController } from "./voice";

class FakeCapture implements Capture {
  starts = 0;
  stops = 0;
  cancelled = 0;
  denied = false;

  async start(): Promise<void> {
    this.starts += 1;
    if (this.denied) {
      throw new DOMException("denied", "NotAllowedError");
    }
  }

  async stop(): Promise<Blob> {
    this.stops += 1;
    return new Blob(["audio"], { type: "audio/webm" });
  }

  cancel(): void {
    this.cancelled += 1;
  }
}

describe("VoiceController", () => {
  test("moves permission → recording → transcribing → armed through the existing voice endpoint", async () => {
    const capture = new FakeCapture();
    const phases: string[] = [];
    let request: Request | undefined;
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ selectedId: "item", needsMeIds: ["item"] }),
      () => undefined,
      capture,
      ((input, init) => {
        request = new Request(input, init);
        return Promise.resolve(
          Response.json({
            ok: true,
            readback: "Say confirm ship.",
            session: {
              pendingConfirm: {
                itemId: "item",
                actionId: "ship",
                label: "Ship",
                armedAt: new Date().toISOString(),
              },
            },
          }),
        );
      }) as typeof fetch,
    );
    controller.subscribe((state) => phases.push(state.phase));
    await controller.press();
    const release = controller.release();
    expect(controller.snapshot().phase).toBe("transcribing");
    await release;
    expect(phases).toEqual([
      "permission",
      "recording",
      "transcribing",
      "armed",
    ]);
    expect(request?.url).toBe("https://hub.test/voice/utterance");
    expect(request?.headers.get("authorization")).toBe("Bearer token");
    expect(request?.headers.get("x-aspex-voice-session")).toMatch(
      /^hl2-.*-voice-session-/,
    );
  });

  test("reports microphone denial explicitly", async () => {
    const capture = new FakeCapture();
    capture.denied = true;
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      capture,
    );
    await controller.press();
    expect(controller.snapshot()).toEqual({
      phase: "error",
      message: "Microphone permission denied.",
      canCancel: false,
    });
  });

  test("a release during the permission prompt cancels capture as soon as permission resolves", async () => {
    let allow: (() => void) | undefined;
    const capture: Capture = {
      start: () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        }),
      stop: async () => null,
      cancel: () => {
        cancelled += 1;
      },
    };
    let cancelled = 0;
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      capture,
    );
    const pressing = controller.press();
    await controller.release();
    allow?.();
    await pressing;
    expect(cancelled).toBe(1);
    expect(controller.snapshot().phase).toBe("idle");
  });

  test("cancels an armed voice session without posting an action", async () => {
    const capture = new FakeCapture();
    const urls: string[] = [];
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      capture,
      ((input) => {
        urls.push(String(input));
        return Promise.resolve(
          urls.length === 1
            ? Response.json({
                ok: true,
                readback: "Say confirm ship.",
                session: {
                  pendingConfirm: {
                    itemId: "item",
                    actionId: "ship",
                    label: "Ship",
                    armedAt: new Date().toISOString(),
                  },
                },
              })
            : Response.json({ ok: true, readback: "Cancelled.", session: {} }),
        );
      }) as typeof fetch,
    );
    await controller.press();
    await controller.release();
    expect(controller.snapshot().phase).toBe("armed");
    await controller.cancel();
    expect(capture.cancelled).toBe(1);
    expect(urls).toEqual([
      "https://hub.test/voice/utterance",
      "https://hub.test/voice/cancel",
    ]);
  });

  test("cancels a dictation session on the Hub", async () => {
    const urls: string[] = [];
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      new FakeCapture(),
      ((input) => {
        urls.push(String(input));
        return Promise.resolve(
          urls.length === 1
            ? Response.json({
                ok: true,
                readback: "Dictate your comment.",
                session: {
                  dictating: { itemId: "item", actionId: "comment" },
                },
              })
            : Response.json({ ok: true, readback: "Cancelled.", session: {} }),
        );
      }) as typeof fetch,
    );

    await controller.press();
    await controller.release();
    expect(controller.snapshot()).toMatchObject({
      phase: "armed",
      canCancel: true,
    });
    await controller.cancel();
    expect(urls).toEqual([
      "https://hub.test/voice/utterance",
      "https://hub.test/voice/cancel",
    ]);
  });

  test("ignores a late utterance result after cancelling its upload", async () => {
    let resolveUtterance: ((response: Response) => void) | undefined;
    const generations: string[] = [];
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      new FakeCapture(),
      ((input, init) => {
        const request = new Request(input, init);
        generations.push(request.headers.get("x-aspex-voice-generation") ?? "");
        if (request.url.endsWith("/voice/utterance")) {
          return new Promise<Response>((resolve) => {
            resolveUtterance = resolve;
          });
        }
        return Promise.resolve(
          Response.json({ ok: true, readback: "Cancelled.", session: {} }),
        );
      }) as typeof fetch,
    );

    await controller.press();
    const releasing = controller.release();
    await Promise.resolve();
    await controller.cancel();
    resolveUtterance?.(
      Response.json({
        ok: true,
        readback: "Say confirm ship.",
        session: {
          pendingConfirm: {
            itemId: "item",
            actionId: "ship",
            label: "Ship",
            armedAt: new Date().toISOString(),
          },
        },
      }),
    );
    await releasing;

    expect(generations).toEqual(["1", "2"]);
    expect(controller.snapshot()).toEqual({
      phase: "idle",
      message: "Cancelled. Hold to speak",
      canCancel: false,
    });
  });

  test("blocks another utterance after an uncertain delivery until cancellation resolves", async () => {
    const capture = new FakeCapture();
    let calls = 0;
    const controller = new VoiceController(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      () => ({ needsMeIds: [] }),
      () => undefined,
      capture,
      ((input) => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? Promise.reject(new Error("network lost"))
            : Response.json({ ok: true, readback: "Cancelled.", session: {} }),
        );
      }) as typeof fetch,
    );

    await controller.press();
    await controller.release();
    expect(controller.snapshot()).toMatchObject({
      phase: "uncertain",
      canCancel: true,
    });
    await controller.press();
    expect(capture.starts).toBe(1);
    await controller.cancel();
    expect(controller.snapshot().phase).toBe("idle");
    await controller.press();
    expect(capture.starts).toBe(2);
  });
});

describe("MicrophoneCapture", () => {
  test("does not include late cancelled recorder chunks in the next capture", async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    const originalMediaRecorder = Object.getOwnPropertyDescriptor(
      globalThis,
      "MediaRecorder",
    );
    let recorderCount = 0;

    class FakeRecorder {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      private listeners = new Map<
        string,
        Array<(event: { data: Blob }) => void>
      >();
      private readonly content = recorderCount++ === 0 ? "cancelled" : "kept";

      addEventListener(
        type: string,
        listener: (event: { data: Blob }) => void,
      ): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        queueMicrotask(() => {
          for (const listener of this.listeners.get("dataavailable") ?? []) {
            listener({ data: new Blob([this.content]) });
          }
          for (const listener of this.listeners.get("stop") ?? []) {
            listener({ data: new Blob() });
          }
        });
      }
    }

    const stream = {
      getTracks: () => [{ stop: () => undefined }],
    } as unknown as MediaStream;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeRecorder,
    });

    try {
      const capture = new MicrophoneCapture();
      await capture.start();
      capture.cancel();
      await capture.start();
      const audio = await capture.stop();

      expect(await audio?.text()).toBe("kept");
    } finally {
      restoreGlobal("navigator", originalNavigator);
      restoreGlobal("MediaRecorder", originalMediaRecorder);
    }
  });
});

function restoreGlobal(
  name: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Object.defineProperty(globalThis, name, descriptor);
}
