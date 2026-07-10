import type { ClientDirective, VoiceContext, VoiceResult } from "@aspex/schema";
import type { DirectionConfig } from "./direction";
import { createIntentId } from "./intentIds";

export type VoicePhase =
  | "idle"
  | "permission"
  | "recording"
  | "transcribing"
  | "armed"
  | "error";

export interface VoiceState {
  phase: VoicePhase;
  message: string;
  canCancel: boolean;
}

export interface Capture {
  start(): Promise<void>;
  stop(): Promise<Blob | null>;
  cancel(): void;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class MicrophoneCapture implements Capture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];

  async start(): Promise<void> {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error("Microphone capture is unavailable in this browser.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.recorder.start();
  }

  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (recorder === null || recorder.state === "inactive") {
      this.release();
      return null;
    }
    return new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const blob =
            this.chunks.length === 0
              ? null
              : new Blob(this.chunks, {
                  type: recorder.mimeType || "audio/webm",
                });
          this.release();
          resolve(blob);
        },
        { once: true },
      );
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export class VoiceController {
  private state: VoiceState = {
    phase: "idle",
    message: "Hold to speak",
    canCancel: false,
  };
  private listeners = new Set<(state: VoiceState) => void>();
  private utteranceIntentId: string | null = null;
  private held = false;
  private readonly fetcher: Fetcher;

  constructor(
    private config: () => DirectionConfig,
    private context: () => VoiceContext,
    private applyDirective: (directive: ClientDirective) => void,
    private capture: Capture = new MicrophoneCapture(),
    fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  snapshot(): VoiceState {
    return { ...this.state };
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async press(): Promise<void> {
    if (
      this.state.phase === "recording" ||
      this.state.phase === "transcribing"
    ) {
      return;
    }
    this.held = true;
    this.utteranceIntentId = createIntentId("voice");
    this.setState("permission", "Requesting microphone…", true);
    try {
      await this.capture.start();
      if (!this.held) {
        this.capture.cancel();
        this.utteranceIntentId = null;
        this.setState("idle", "Hold to speak", false);
        return;
      }
      this.setState("recording", "Listening — release to send", true);
    } catch (error) {
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError";
      this.setState(
        "error",
        denied ? "Microphone permission denied." : errorMessage(error),
        false,
      );
    }
  }

  async release(): Promise<void> {
    this.held = false;
    if (this.state.phase !== "recording") {
      return;
    }
    this.setState("transcribing", "Transcribing on the Hub…", true);
    const audio = await this.capture.stop();
    if (audio === null || audio.size === 0) {
      this.utteranceIntentId = null;
      this.setState("error", "No audio was captured.", false);
      return;
    }

    const form = new FormData();
    form.append("audio", audio, "utterance.webm");
    form.append("context", JSON.stringify(this.context()));
    if (this.utteranceIntentId !== null) {
      form.append("intentId", this.utteranceIntentId);
    }
    try {
      const cfg = this.config();
      const response = await this.fetcher(
        `${trimUrl(cfg.hubUrl)}/voice/utterance`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.token}` },
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error(`Voice request failed with HTTP ${response.status}.`);
      }
      const result = (await response.json()) as VoiceResult;
      if (result.directive !== undefined) {
        this.applyDirective(result.directive);
      }
      const armed =
        result.session.pendingConfirm !== undefined ||
        result.session.pendingDispatch !== undefined;
      this.setState(
        armed ? "armed" : result.ok ? "idle" : "error",
        result.readback,
        armed,
      );
    } catch (error) {
      this.setState("error", errorMessage(error), false);
    } finally {
      this.utteranceIntentId = null;
    }
  }

  async cancel(): Promise<void> {
    this.held = false;
    this.capture.cancel();
    this.utteranceIntentId = null;
    if (this.state.phase === "armed") {
      try {
        const cfg = this.config();
        await this.fetcher(`${trimUrl(cfg.hubUrl)}/voice/cancel`, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.token}` },
        });
      } catch {
        // The local arm is still cleared; the Hub-side arm also expires and
        // cannot deliver without a later explicit confirm utterance.
      }
    }
    this.setState("idle", "Cancelled. Hold to speak", false);
  }

  private setState(
    phase: VoicePhase,
    message: string,
    canCancel: boolean,
  ): void {
    this.state = { phase, message, canCancel };
    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Voice failed.";
}
