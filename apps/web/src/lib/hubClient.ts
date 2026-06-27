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

export async function connect(): Promise<EventSource> {
  const hub = await getHubUrl();
  const stream = new EventSource(`${hub}/stream`);

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
): Promise<ActionResult> {
  const hub = await getHubUrl();
  const response = await fetch(
    `${hub}/actions/${encodeURIComponent(itemId)}/${encodeURIComponent(
      actionId,
    )}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed }),
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

async function getHubUrl(): Promise<string> {
  hubUrl ??= resolveHubUrl();
  return hubUrl;
}

async function resolveHubUrl(): Promise<string> {
  const configured = import.meta.env.VITE_HUB_URL;

  if (typeof configured === "string" && configured.trim() !== "") {
    return configured;
  }

  const invoke = (window as TauriGlobals).__TAURI__?.core?.invoke;

  if (typeof invoke === "function") {
    return invoke<string>("hub_url");
  }

  return DEFAULT_HUB_URL;
}
