import { describe, expect, test } from "bun:test";
import { type Capture, VoiceController } from "./voice";

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
});
