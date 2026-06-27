# Card 11 — `apps/web` scaffold (Vite + React + SSE client)

## Goal
Stand up the web client: Vite + React + TS + Tailwind + Zustand, an SSE client that keeps the world-model in a store (with reconnect), and a bare screen proving live data flows from the Hub.

## Depends on
- Card 07 (`/stream`, `/state`), Card 10 (mock data to see).

## Files to create
```
apps/web/package.json
apps/web/vite.config.ts
apps/web/index.html
apps/web/tailwind.config.ts  +  postcss.config.js
apps/web/src/main.tsx
apps/web/src/App.tsx
apps/web/src/lib/hubClient.ts     # EventSource -> store
apps/web/src/store.ts             # Zustand store
apps/web/src/types.ts             # re-import from @aspex/schema
```

## Dependencies
```bash
cd apps/web && bun add react react-dom zustand && bun add -d vite @vitejs/plugin-react typescript tailwindcss postcss autoprefixer @aspex/schema
```

## Store + client

**`store.ts`**:
```ts
import { create } from "zustand";
import type { AttentionItem } from "@aspex/schema";
interface RankedState { needsMe: AttentionItem[]; overflow: AttentionItem[]; ambient: AttentionItem[]; generatedAt: string; }
interface Store extends RankedState { connected: boolean; setState(s: RankedState): void; setConnected(c: boolean): void; }
export const useStore = create<Store>((set) => ({ needsMe: [], overflow: [], ambient: [], generatedAt: "", connected: false, setState: (s)=>set(s), setConnected:(connected)=>set({connected}) }));
```

**`hubClient.ts`**:
```ts
const HUB = import.meta.env.VITE_HUB_URL ?? "http://127.0.0.1:4317";
export function connect() {
  const es = new EventSource(`${HUB}/stream`);
  es.addEventListener("state", (e) => useStore.getState().setState(JSON.parse((e as MessageEvent).data)));
  es.onopen = () => useStore.getState().setConnected(true);
  es.onerror = () => { useStore.getState().setConnected(false); /* EventSource auto-reconnects; optionally backoff */ };
  return es;
}
export async function runAction(itemId: string, actionId: string, confirmed = false) {
  return fetch(`${HUB}/actions/${encodeURIComponent(itemId)}/${actionId}`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ confirmed }) });
}
```

## Steps
1. Scaffold Vite React-TS; add Tailwind (`tailwind.config` content globs include `./src/**/*.tsx`).
2. Implement store + client.
3. `App.tsx`: call `connect()` on mount; render a connection dot (green/red) and `needsMe.length` / `ambient.length` counts updating live.
4. `vite.config.ts`: dev server port (e.g. 5173); no proxy needed (client hits the Hub URL directly; ensure Hub CORS from card 07 allows it).

## Acceptance check
```bash
# terminal 1:
bun run apps/hub/src/cli.ts hub --mock
# terminal 2:
cd apps/web && bun run dev
# open http://localhost:5173 -> connection dot is green; needs-me / ambient counts
# change over the first ~10s as mock signals arrive and decay.
```

## Out of scope / do NOT do
- No card/inbox UI yet (card 12), no actions UI (card 13), no liveness styling (card 14). Counts only.
- Do not bundle Tauri here (card 19).
- Do not add a router or data-fetching library — SSE + one store is enough.
