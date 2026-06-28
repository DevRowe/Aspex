# Card 55 — `adapter-opencode` (observe-only, local SSE-fed)

## Goal
Surface **opencode** sessions that need you. **Observe + deep-link only** (ADR-0021): agent-local attention only (`working`/`blocked`/`error` before/without a PR — PR-lifecycle stays the github adapter's, ADR-0002); liveness from the event stream itself. Ingestion is a subscription to the local **`opencode serve` `/event` SSE** stream — no inbound exposure, no polling, no control actions.

## Depends on
- Card 02 (`Adapter` interface, `Signal`), Card 04 (world-model `applySignal`), Card 06 (liveness/heartbeat).
- Card 08 (`AdapterRegistry` — registration happens in card 57, not here).
- Card 47/46 (the `opencode` Source is now in the glossary enum).

## Files to create
```
packages/adapter-opencode/package.json
packages/adapter-opencode/src/index.ts          # OpenCodeAdapter (start = connect SSE; map events -> Signals)
packages/adapter-opencode/src/map.ts             # pure: opencode event -> Signal | heartbeat | ignore
packages/adapter-opencode/src/sse.ts             # thin SSE client (reconnect/backoff; injectable fetch)
packages/adapter-opencode/test/map.test.ts
packages/adapter-opencode/test/replay.test.ts    # feeds recorded fixtures through map -> asserts Items
packages/adapter-opencode/test/fixtures/*.jsonl  # recorded /event lines (no real server needed)
```

## Config
```ts
// adapters.opencode in ~/.aspex config (loaded by the Hub, card 09/57)
interface OpenCodeAdapterConfig {
  enabled: boolean;     // default false
  serverUrl: string;    // e.g. http://127.0.0.1:4096 (the `opencode serve` address)
  directory?: string;   // optional project scope for /event
}
```

## Ingestion
`opencode serve` exposes an **OpenAPI** HTTP server with an SSE **`/event`** endpoint streaming instance-scoped events (`session.created`, `message.updated`, session lifecycle, …). On `start(ctx)`:
1. If `!enabled`, return immediately (no-op, like voice/previews off).
2. Open an SSE connection to `${serverUrl}/event` (scoped to `directory` if set). On connect failure or drop, **reconnect with backoff** — never throw out of `start`; the Hub keeps running if opencode isn't up (capability-degrade, like the Docker probe in ADR-0017).
3. For each event line, run the **pure** `mapEvent` (card's `map.ts`) → either a `Signal` (`ctx.emit`), a heartbeat (`ctx.heartbeat("opencode")`), or ignore.
4. A live `/event` connection is itself the liveness signal: emit `ctx.heartbeat("opencode")` on **any** received event (and on a keepalive ping) so sessions decay to `stale`/`lost` if the stream dies (ADR-0003).

## Event → Signal mapping (`map.ts`, pure)
> **Confirm the exact event names against the opencode OpenAPI spec when building** — the SDK exposes 80+ types; map only the few that carry attention. Record real `/event` output into the `fixtures/*.jsonl` and drive the tests from them. Proposed mapping:

| opencode event (verify) | Item | State / Reason |
|---|---|---|
| session awaiting user input / permission | `opencode:session:<id>` | `state: blocked`, `reason: blocked_on_human`, attentionRequired, `deepLink` |
| session error / aborted | `opencode:session:<id>` | `state: error`, `reason: errored`, attentionRequired |
| session running / message streaming | `opencode:session:<id>` | `state: working`, Ambient (attentionRequired **false**) + heartbeat |
| session completed/idle | `opencode:session:<id>` | `state: done`, Ambient (ADR-0002 — completion is not attention) |
| everything else | — | ignore (but still counts as a heartbeat) |

`deepLink`: a focus URL/path for the session (e.g. `${serverUrl}` + session route, or the working directory) — read-only, no control.

## `Adapter` surface
- `listActions(itemId)` → **always `[]`** (observe-only, ADR-0021).
- `runAction(...)` → `{ ok:false, message:"opencode is observe-only in Phase 3" }` (no two-way control — deferred to a future ADR).
- `stop()` → close the SSE connection cleanly.

## Acceptance check
```bash
bun test packages/adapter-opencode   # green
```
Tests must prove (all against **fixtures**, no real `opencode serve`):
- A "blocked/awaiting input" fixture line → an Item `state: blocked`, `reason: blocked_on_human`, attentionRequired true, `actions: []`, `deepLink` set.
- An "error" fixture → `state: error`, attentionRequired true.
- A "completed" fixture → `state: done`, Ambient, attentionRequired **false** (ADR-0002).
- A "running/message" fixture refreshes liveness (heartbeat) but does **not** flip a `blocked` Item back to `working` (reuse the claude-code heartbeat rule, card 16).
- `runAction` returns the observe-only refusal.
- With `enabled:false`, `start` connects to nothing and emits no Items.

Manual smoke (optional, not CI): run `opencode serve`, set `serverUrl`, start a session that asks for permission → a `blocked` card appears; finish it → it moves to Ambient.

## Out of scope / do NOT do
- **No control / no two-way** (ADR-0021). Deep-link only; `runAction` always refuses.
- Do **not** poll the OpenAPI session endpoints — subscribe to `/event` (push, local). Polling is the cursor problem (ADR-0022), not opencode's.
- Do not claim PR-lifecycle attention — if an opencode session opens a PR, **github** owns that (ADR-0002).
- Do not require `opencode serve` to be running for the Hub to start — degrade gracefully, reconnect in the background.
- Do not register the adapter here — wiring into the `AdapterRegistry` + source→adapter map is card 57.
