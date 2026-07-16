import { useStore } from "../store";
import type { ActionResult } from "../types";
import type { RankedState } from "../types";

const DEFAULT_HUB_URL = "http://127.0.0.1:4317";
let hubUrl: Promise<string> | undefined;

interface TauriGlobals {
  __TAURI__?: {
    core?: {
      invoke?: <T>(command: string) => Promise<T>;
    };
  };
}

export interface HubClientConfig {
  intentEnabled?: boolean;
  intent?: {
    enabled?: boolean;
  };
}

export async function connect(): Promise<EventSource> {
  const hub = await getHubUrl();
  const token = await getHubToken();
  const streamUrl = new URL(`${hub}/stream`);

  if (token !== undefined) {
    streamUrl.searchParams.set("token", token);
  }

  const stream = new EventSource(streamUrl.toString());

  stream.addEventListener("state", (event) => {
    const state = JSON.parse(
      (event as MessageEvent<string>).data,
    ) as RankedState;
    useStore.getState().setState(state);
  });
  stream.onopen = () => useStore.getState().setConnected(true);
  stream.onerror = () => useStore.getState().setConnected(false);

  return stream;
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
