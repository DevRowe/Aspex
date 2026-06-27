# Card 07 — Hub: HTTP server (Hono — SSE + REST)

## Goal
Expose the world-model over HTTP: an SSE stream of ranked snapshots, a snapshot endpoint, a Signal ingest endpoint (used by hook-relay + webhook), an action-dispatch endpoint, and health. Single process, SSE + REST only (ADR-0005).

## Depends on
- Card 04 (bus + world-model), Card 05 (rank), Card 08 provides the action dispatcher — **but** to keep ordering clean, this card accepts a `dispatchAction` callback injected at construction (real one wired in card 08/09).

## Files to create
```
apps/hub/src/http/server.ts        # buildApp(deps) -> Hono app
apps/hub/src/http/sse.ts           # SSE helper
apps/hub/test/server.test.ts
```

## Dependencies to add
```bash
bun add hono
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `200 {ok:true, version}` |
| GET | `/state` | `{ needsMe, overflow, ambient, generatedAt }` via `rank(snapshot, cap)` |
| GET | `/stream` | SSE. On connect: send current `/state` as a `state` event. On every `world:changed`: re-rank and push a `state` event. Comment-ping every 15s to keep alive. |
| POST | `/signals/:source` | Body = Signal. `assertSignal`, force `source` to match the path, `worldModel.applySignal`. `202`. |
| POST | `/actions/:itemId/:actionId` | Body `{ confirmed?: boolean, payload?: unknown }`. If the action `requiresConfirmation` and `!confirmed` → `409`. Else `dispatchAction(...)` → `ActionResult`. |

## Stub
```ts
import { Hono } from "hono";
export interface ServerDeps {
  worldModel: import("../world/worldModel").WorldModel;
  bus: import("../bus").Bus;
  cap: number;
  version: string;
  dispatchAction: (itemId: string, actionId: string, payload?: unknown) => Promise<import("@aspex/schema").ActionResult>;
  actionMeta: (itemId: string, actionId: string) => { requiresConfirmation: boolean } | null;
}
export function buildApp(deps: ServerDeps): Hono { /* ... */ }
```

## Steps
1. `buildApp` wires routes above. Keep handlers thin.
2. SSE: in `/stream`, create a `ReadableStream`; subscribe to `bus.on("world:changed", ...)`; on each, write `event: state\ndata: <json>\n\n`. Clean up the subscription when the stream closes.
3. CORS: allow `http://localhost:*` and the Tauri origin (`tauri://localhost`). Add a permissive dev CORS middleware.
4. Validation errors → `400` with a JSON message.
5. Tests: use `app.fetch(new Request(...))` (Hono works on Bun's fetch) — no real socket needed.

## Acceptance check
```bash
bun test apps/hub/test/server.test.ts   # green
```
Tests must prove:
- `GET /health` → 200.
- `POST /signals/github` with a valid Signal → 202, and a subsequent `GET /state` includes the Item.
- `POST /actions/:id/:action` for a `requiresConfirmation` action without `confirmed:true` → 409; with `confirmed:true` → calls `dispatchAction`.
- A bad Signal body → 400.

## Out of scope / do NOT do
- No WebSocket / Socket.IO / NATS (ADR-0005). SSE + REST only.
- Do not put adapter logic here — actions go through the injected `dispatchAction`.
- Do not auth/login (Phase 0 is local-only). Bind to `127.0.0.1` only (card 09), not `0.0.0.0`.
