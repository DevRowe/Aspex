# Card 41 — Hub HTTP + SSE preview endpoints

## Goal
Expose the Preview REST surface and stream `preview` state changes over the **existing** Hub SSE bus, wiring the broker (40) + registry (39). Mounted **only when `previews.enabled`**; absent/404 when off. Reuses card 07's Hono server and SSE bus — no new transport.

## Depends on
- Card 40 (`PreviewBroker`), Card 39 (`PreviewRegistry`), Card 07 (Hono server + SSE bus + route mounting), Card 36 (types).

## Files to create
```
apps/hub/src/http/preview.ts          # the /previews router + SSE wiring
```
## Files to edit
```
apps/hub/src/http/server.ts           # mount the router + SSE source when previews.enabled
```

## HTTP surface + status mapping
| Method + path | Behaviour | Codes |
|---|---|---|
| `GET /previews/specs` | `registry.list()` (trust + itemId) | 200 |
| `POST /previews` `{specId}` | `broker.boot(specId)` | **201** Preview · **404** unknown spec · **403** untrusted (pixels lane n/a) · **429** max-concurrent |
| `GET /previews` | `broker.list()` | 200 |
| `GET /previews/:id` | `broker.get` | 200 · 404 |
| `DELETE /previews/:id` | `broker.stop` | 204 · 404 |
| SSE `preview` event | `broker.onChange` → existing bus | — |

## Behaviour
- Map broker rejections to the codes above (distinguish the reasons: unknown spec / untrusted / cap). Each error body carries a human `message` the Deck shows.
- **SSE:** on mount, `broker.onChange((p) => bus.publish("preview", p))` so every `booting → ready → crashed → stopped` transition reaches the client over its existing SSE connection. Do **not** open a second SSE endpoint.
- **Disabled:** when `previews.enabled` is false, do not mount the router and do not publish `preview` events. (Card 44 exposes the flag to the client so the Deck hides itself.)
- The Hub stays bound to `127.0.0.1` (ADR-0005). The Hub **never proxies** a preview's content — the iframe talks to `127.0.0.1:<port>` directly (card 42).

## Steps
1. `preview.ts` router with the five routes + status mapping, taking `{ broker, registry }`.
2. Wire `broker.onChange` → SSE bus.
3. In `server.ts`, mount conditionally on `previews.enabled`.
4. Tests `apps/hub/test/preview/http.test.ts` with a **fake broker/registry** (no Docker): each route + each status code; disabled → routes 404; an `onChange` emission publishes a `preview` SSE event.

## Acceptance check
```
cd apps/hub && bun test test/preview/http.test.ts
```
Expected: all route/status/SSE cases pass with **no Docker**. `bun run typecheck` + `bun run lint` clean.

## Out of scope / do NOT do
- No engine/Docker (behind the broker), no web client.
- Do not expose preview ports through the Hub or relax the `127.0.0.1` bind (ADR-0005).
- Do not stream agent/preview **content** through the Hub — only `Preview` state events.
- Do not boot on `GET` or auto-boot — only explicit `POST` boots (guardrail 15).
