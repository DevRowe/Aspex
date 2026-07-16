import { type EventSourceMessage, createParser } from "eventsource-parser";
import { useStore } from "../store";
import type { ActionResult } from "../types";
import type { RankedState } from "../types";

const DEFAULT_HUB_URL = "http://127.0.0.1:4317";
const STREAM_RETRY_MS = 3_000;
let hubUrl: Promise<string> | undefined;

interface TauriGlobals {
  __TAURI__?: {
    core?: {
      invoke?: <T>(command: string) => Promise<T>;
    };
  };
}

export interface HubStream {
  close(): void;
}

export interface HubClientConfig {
  intentEnabled?: boolean;
  intent?: {
    enabled?: boolean;
  };
}

export async function connect(): Promise<HubStream> {
  const hub = await getHubUrl();
  let closed = false;
  let abort: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryResolve: (() => void) | undefined;

  const handleEvent = (message: EventSourceMessage): void => {
    try {
      if (message.event === "state") {
        useStore.getState().setState(JSON.parse(message.data) as RankedState);
      }
      // Unknown event types are tolerated and ignored.
    } catch (error) {
      // A malformed event must not tear down the stream.
      console.warn("Ignoring malformed Hub stream event", error);
    }
  };

  const run = async (): Promise<void> => {
    while (!closed) {
      const controller = new AbortController();
      abort = controller;
      try {
        const response = await hubFetch(`${hub}/stream`, {
          headers: { accept: "text/event-stream" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          console.error(
            `Hub stream rejected the bearer token with HTTP ${response.status}; not retrying until reconnected.`,
          );
          return;
        }
        if (!response.ok || response.body === null) {
          throw new Error(`Hub stream failed with HTTP ${response.status}`);
        }
        useStore.getState().setConnected(true);
        const parser = createParser({ onEvent: handleEvent });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done || closed) {
            break;
          }
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Unreachable Hub or aborted stream; fall through to reconnect.
      } finally {
        controller.abort();
        useStore.getState().setConnected(false);
      }
      if (closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        retryResolve = resolve;
        retryTimer = setTimeout(resolve, STREAM_RETRY_MS);
      });
      retryTimer = undefined;
      retryResolve = undefined;
    }
  };
  void run();

  return {
    close(): void {
      closed = true;
      abort?.abort();
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      retryResolve?.();
      retryResolve = undefined;
    },
  };
}

export async function runAction(
  itemId: string,
  actionId: string,
  confirmed = false,
  payload?: Record<string, unknown>,
): Promise<ActionResult> {
  const hub = await getHubUrl();
  const response = await hubFetch(
    `${hub}/actions/${encodeURIComponent(itemId)}/${encodeURIComponent(
      actionId,
    )}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmed,
        ...(payload === undefined ? {} : { payload }),
      }),
    },
  );
  const body = (await response
    .json()
    .catch(() => ({}))) as Partial<ActionResult>;

  return {
    ok: response.ok && body.ok !== false,
    message: body.message ?? response.statusText,
  };
}

export async function getHubConfig(): Promise<HubClientConfig> {
  const hub = await getHubUrl();
  const response = await hubFetch(`${hub}/config`);

  if (!response.ok) {
    throw new Error(`Hub config unavailable: ${response.status}`);
  }

  return (await response.json()) as HubClientConfig;
}

export async function getHubUrl(): Promise<string> {
  hubUrl ??= resolveHubUrl();
  return hubUrl;
}

export async function getHubToken(): Promise<string | undefined> {
  return resolveHubToken();
}

export async function hubFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getHubToken();
  const headers = new Headers(init.headers);

  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}

async function resolveHubUrl(): Promise<string> {
  const configured = import.meta.env.VITE_HUB_URL;

  if (typeof configured === "string" && configured.trim() !== "") {
    return configured;
  }

  const invoke =
    typeof window === "undefined"
      ? undefined
      : (window as TauriGlobals).__TAURI__?.core?.invoke;

  if (typeof invoke === "function") {
    return invoke<string>("hub_url");
  }

  return DEFAULT_HUB_URL;
}

async function resolveHubToken(): Promise<string | undefined> {
  const invoke =
    typeof window === "undefined"
      ? undefined
      : (window as TauriGlobals).__TAURI__?.core?.invoke;

  if (typeof invoke === "function") {
    const token = await invoke<string | null>("hub_token");
    const trimmed = token?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  }

  const configured = import.meta.env.VITE_HUB_TOKEN;

  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.trim();
  }

  return undefined;
}
