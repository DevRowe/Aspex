import type { ClientDirective, VoiceContext, VoiceResult } from "@aspex/schema";
import type { DirectionConfig } from "./direction";
import { createIntentId } from "./intentIds";

export type VoicePhase =
  | "idle"
  | "permission"
  | "recording"
  | "transcribing"
  | "armed"
  | "uncertain"
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
  private activeCapture: ActiveCapture | null = null;

  async start(): Promise<void> {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error("Microphone capture is unavailable in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const capture: ActiveCapture = {
      stream,
      recorder,
      chunks: [],
      cancelled: false,
    };
    this.activeCapture = capture;
    recorder.addEventListener("dataavailable", (event) => {
      if (
        this.activeCapture === capture &&
        !capture.cancelled &&
        event.data.size > 0
      ) {
        capture.chunks.push(event.data);
      }
    });
    recorder.start();
  }

  async stop(): Promise<Blob | null> {
    const capture = this.activeCapture;
    if (capture === null || capture.recorder.state === "inactive") {
      this.release(capture);
      return null;
    }
    const recorder = capture.recorder;
    return new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const blob =
            capture.cancelled || capture.chunks.length === 0
              ? null
              : new Blob(capture.chunks, {
                  type: recorder.mimeType || "audio/webm",
                });
          this.release(capture);
          resolve(blob);
        },
        { once: true },
      );
      recorder.stop();
    });
  }

  cancel(): void {
    const capture = this.activeCapture;
    if (capture === null) {
      return;
    }
    capture.cancelled = true;
    if (capture.recorder.state === "recording") {
      capture.recorder.stop();
    }
    this.release(capture);
  }

  private release(capture: ActiveCapture | null): void {
    if (capture === null) {
      return;
    }
    for (const track of capture.stream.getTracks()) {
      track.stop();
    }
    if (this.activeCapture === capture) {
      this.activeCapture = null;
    }
  }
}

interface ActiveCapture {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  cancelled: boolean;
}

export class VoiceController {
  private state: VoiceState = {
    phase: "idle",
    message: "Hold to speak",
    canCancel: false,
  };
  private listeners = new Set<(state: VoiceState) => void>();
  private utteranceIntentId: string | null = null;
  private hubSessionActive = false;
  private held = false;
  private voiceGeneration = 0;
  private readonly fetcher: Fetcher;
  private readonly clientSessionId = createIntentId("voice-session");

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
      this.state.phase === "permission" ||
      this.state.phase === "transcribing" ||
      this.state.phase === "uncertain"
    ) {
      return;
    }
    this.held = true;
    const generation = ++this.voiceGeneration;
    this.utteranceIntentId = createIntentId("voice");
    this.setState("permission", "Requesting microphone…", true);
    try {
      await this.capture.start();
      if (!this.held || generation !== this.voiceGeneration) {
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
    const generation = this.voiceGeneration;
    const intentId = this.utteranceIntentId;
    this.setState("transcribing", "Transcribing on the Hub…", true);
    const audio = await this.capture.stop();
    if (generation !== this.voiceGeneration) {
      return;
    }
    if (audio === null || audio.size === 0) {
      this.utteranceIntentId = null;
      this.setState("error", "No audio was captured.", false);
      return;
    }

    const form = new FormData();
    form.append("audio", audio, "utterance.webm");
    form.append("context", JSON.stringify(this.context()));
    if (intentId !== null) {
      form.append("intentId", intentId);
    }
    try {
      const cfg = this.config();
      const response = await this.fetcher(
        `${trimUrl(cfg.hubUrl)}/voice/utterance`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${cfg.token}`,
            "x-aspex-voice-session": this.clientSessionId,
            "x-aspex-voice-generation": String(generation),
          },
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error(`Voice request failed with HTTP ${response.status}.`);
      }
      const result = (await response.json()) as VoiceResult;
      if (generation !== this.voiceGeneration) {
        return;
      }
      if (result.directive !== undefined) {
        this.applyDirective(result.directive);
      }
      const armed =
        result.session.pendingConfirm !== undefined ||
        result.session.pendingDispatch !== undefined;
      this.hubSessionActive = armed || result.session.dictating !== undefined;
      this.setState(
        this.hubSessionActive ? "armed" : result.ok ? "idle" : "error",
        result.readback,
        this.hubSessionActive,
      );
      this.utteranceIntentId = null;
    } catch (error) {
      if (generation !== this.voiceGeneration) {
        return;
      }
      this.hubSessionActive = true;
      this.setState(
        "uncertain",
        `${errorMessage(error)} Delivery is uncertain; cancel before speaking again.`,
        true,
      );
    }
  }

  async cancel(): Promise<void> {
    this.held = false;
    const generation = ++this.voiceGeneration;
    this.capture.cancel();
    const mustCancelHubSession =
      this.hubSessionActive ||
      this.state.phase === "transcribing" ||
      this.state.phase === "uncertain";
    if (mustCancelHubSession) {
      try {
        const cfg = this.config();
        const response = await this.fetcher(
          `${trimUrl(cfg.hubUrl)}/voice/cancel`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${cfg.token}`,
              "x-aspex-voice-session": this.clientSessionId,
              "x-aspex-voice-generation": String(generation),
            },
          },
        );
        if (!response.ok) {
          throw new Error(
            `Voice cancellation failed with HTTP ${response.status}.`,
          );
        }
      } catch (error) {
        this.setState(
          "uncertain",
          `${errorMessage(error)} Cancellation is uncertain; try again before speaking.`,
          true,
        );
        return;
      }
    }
    this.hubSessionActive = false;
    this.utteranceIntentId = null;
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
