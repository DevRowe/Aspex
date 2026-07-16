import { type EventSourceMessage, createParser } from "eventsource-parser";
import {
  type ConnectionState,
  type RankedState,
  parseRankedState,
} from "./domain";

export interface HubConnectionConfig {
  hubUrl: string;
  token: string;
}

export interface HubClientDeps {
  fetcher?: Fetcher;
  now?: () => number;
  online?: () => boolean;
  setTimer?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HubClientEvents {
  onState(state: RankedState): void;
  onConnection(state: ConnectionState): void;
  onMalformed(message: string): void;
}

const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const STALE_AFTER_MS = 30_000;

export class HubClient {
  private streamAbort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private generation = 0;
  private attempt = 0;
  private lastStateAt: number | undefined;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly online: () => boolean;
  private readonly setTimer: NonNullable<HubClientDeps["setTimer"]>;
  private readonly clearTimer: NonNullable<HubClientDeps["clearTimer"]>;

  constructor(
    private config: () => HubConnectionConfig | null,
    private events: HubClientEvents,
    deps: HubClientDeps = {},
  ) {
    this.fetcher =
      deps.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.online = deps.online ?? (() => navigator.onLine !== false);
    this.setTimer =
      deps.setTimer ??
      ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer =
      deps.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
  }

  start(): void {
    this.stop();
    this.stopped = false;
    this.attempt = 0;
    const cfg = this.config();
    if (cfg === null || cfg.hubUrl.trim() === "" || cfg.token.trim() === "") {
      this.emit("unconfigured", "Pair a Hub URL and token to begin.");
      return;
    }
    void this.connectAttempt(++this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.streamAbort?.abort();
    this.streamAbort = null;
    if (this.retryTimer !== undefined) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private async connectAttempt(generation: number): Promise<void> {
    const cfg = this.config();
    if (this.stopped || cfg === null || generation !== this.generation) {
      return;
    }

    this.emit(
      this.attempt === 0 ? "connecting" : "reconnecting",
      "Hydrating authenticated Hub state…",
    );
    let response: Response;
    try {
      response = await this.fetcher(`${trimUrl(cfg.hubUrl)}/state`, {
        headers: { authorization: `Bearer ${cfg.token}` },
        cache: "no-store",
      });
    } catch {
      this.scheduleReconnect(generation, "Hub is unreachable.");
      return;
    }

    if (this.stopped || generation !== this.generation) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      this.emit("auth_failed", "Hub rejected the bearer token.");
      return;
    }
    if (!response.ok) {
      this.scheduleReconnect(
        generation,
        `Hub state failed with HTTP ${response.status}.`,
      );
      return;
    }

    try {
      const state = parseRankedState(await response.json());
      if (!this.isCurrent(generation)) {
        return;
      }
      this.acceptState(state);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Malformed Hub snapshot";
      this.events.onMalformed(message);
      this.emit("malformed", message);
      this.scheduleReconnect(generation, message);
      return;
    }

    if (!this.isCurrent(generation)) {
      return;
    }
    const controller = new AbortController();
    this.streamAbort = controller;
    let streamResponse: Response;
    try {
      streamResponse = await this.fetcher(`${trimUrl(cfg.hubUrl)}/stream`, {
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: "text/event-stream",
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (!this.isCurrentStream(generation, controller)) {
        return;
      }
      this.streamAbort = null;
      this.scheduleReconnect(generation, "Hub stream interrupted.");
      return;
    }
    if (!this.isCurrentStream(generation, controller)) {
      controller.abort();
      return;
    }
    if (streamResponse.status === 401 || streamResponse.status === 403) {
      controller.abort();
      this.streamAbort = null;
      this.emit("auth_failed", "Hub rejected the bearer token.");
      return;
    }
    if (!streamResponse.ok || streamResponse.body === null) {
      controller.abort();
      this.streamAbort = null;
      this.scheduleReconnect(
        generation,
        `Hub stream failed with HTTP ${streamResponse.status}.`,
      );
      return;
    }

    this.attempt = 0;
    this.emit("live", "Authenticated stream connected.");
    try {
      await this.readStream(streamResponse.body, generation, controller);
    } catch {
      // Aborted or the transport dropped; reconnect below if still current.
    }
    if (!this.isCurrentStream(generation, controller)) {
      return;
    }
    this.streamAbort = null;
    this.scheduleReconnect(generation, "Hub stream interrupted.");
  }

  private async readStream(
    body: ReadableStream<Uint8Array>,
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    const parser = createParser({
      onEvent: (message) =>
        this.handleStreamEvent(message, generation, controller),
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done || !this.isCurrentStream(generation, controller)) {
        return;
      }
      parser.feed(decoder.decode(value, { stream: true }));
    }
  }

  private handleStreamEvent(
    message: EventSourceMessage,
    generation: number,
    controller: AbortController,
  ): void {
    if (!this.isCurrentStream(generation, controller)) {
      return;
    }
    if (message.event !== "state") {
      return;
    }
    try {
      this.acceptState(parseRankedState(JSON.parse(message.data) as unknown));
      this.emit("live", "Authenticated stream connected.");
    } catch (error) {
      if (!this.isCurrentStream(generation, controller)) {
        return;
      }
      const detail =
        error instanceof Error ? error.message : "Malformed Hub stream event";
      this.events.onMalformed(detail);
      this.emit("malformed", detail);
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private isCurrentStream(
    generation: number,
    controller: AbortController,
  ): boolean {
    return this.isCurrent(generation) && this.streamAbort === controller;
  }

  private acceptState(state: RankedState): void {
    this.lastStateAt = this.now();
    this.events.onState(state);
  }

  private scheduleReconnect(generation: number, detail: string): void {
    if (
      this.stopped ||
      generation !== this.generation ||
      this.retryTimer !== undefined
    ) {
      return;
    }
    const offline = !this.online();
    const stale =
      this.lastStateAt !== undefined &&
      this.now() - this.lastStateAt > STALE_AFTER_MS;
    this.emit(offline ? "offline" : stale ? "stale" : "reconnecting", detail);
    const delay =
      RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)] ??
      15_000;
    this.attempt += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      void this.connectAttempt(generation);
    }, delay);
  }

  private emit(phase: ConnectionState["phase"], detail: string): void {
    this.events.onConnection({
      phase,
      detail,
      attempt: this.attempt,
      ...(this.lastStateAt === undefined
        ? {}
        : { lastStateAt: new Date(this.lastStateAt).toISOString() }),
    });
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
