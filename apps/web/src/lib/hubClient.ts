import { useStore } from "../store";
import type { ActionResult } from "../types";
import type { RankedState } from "../types";

const HUB = import.meta.env.VITE_HUB_URL ?? "http://127.0.0.1:4317";

export function connect(): EventSource {
  const stream = new EventSource(`${HUB}/stream`);

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
  const response = await fetch(
    `${HUB}/actions/${encodeURIComponent(itemId)}/${encodeURIComponent(
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
