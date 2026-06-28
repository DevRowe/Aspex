# Card 45 — Docs + threat-model + licenses + CI (end-to-end mock)

## Goal
Land the canonical `docs/preview-deck.md`, extend `docs/threat-model.md` with a **shipped** Preview Deck section, update `docs/licenses.md`, and add the **end-to-end mock acceptance** (boot → ready → stop through the real HTTP + broker + mock engine, asserting SSE events and **zero leaked previews**) to the CI `bun test` run. This is the Preview-Deck analogue of card 34.

## Depends on
- All prior Preview-Deck cards (36–44).

## Files to create
```
docs/preview-deck.md
apps/hub/test/preview/e2e-mock.test.ts
```
## Files to edit
```
docs/threat-model.md       # add a "Preview Deck (Phase 2)" section
docs/licenses.md           # note no new AGPL/GPL, no new runtime deps, docker-via-CLI
```

## Content
- **`docs/preview-deck.md`** (the canonical reference): the **spec format** with a worked `~/.aspex` registry example; the **trust lanes** (trusted iframe v1 / pixels deferred, ADR-0016); the **lifecycle** (explicit boot, pull-not-build, bounded, reap on close/TTL/shutdown, startup sweep, crash-visible); the **security model** (cross-origin `127.0.0.1` isolation, exact sandbox attrs, no Hub creds); the **REST/SSE contract**; **guardrails 14–18**; and the deferred follow-ups (pixels/neko lane, adapter-surfaced specs, glTF/AR, spatial tiles).
- **`docs/threat-model.md`** — add a `## Preview Deck (Phase 2)` section (mirror the *Voice (Phase 1)* section's style): opt-in/off-by-default; boots declared specs only, never builds (ADR-0014); a Preview is ephemeral, never world-model state (ADR-0015); trusted-only cross-origin sandboxed iframe with no creds, the untrusted pixels lane not yet shipped (ADR-0016); bounded + no-orphan reaping; Hub stays `127.0.0.1`; mock-first, Docker opt-in/detected. Tighten the older "Future Labs Isolation" paragraph to point here for what actually shipped.
- **`docs/licenses.md`** — note: Docker invoked **via CLI, not linked**; **no new npm runtime deps** (iframe + fetch + SSE already present); **no AGPL/GPL** added; neko / model-viewer remain **deferred / not added**.

## E2E mock test (`e2e-mock.test.ts`)
With `previews.enabled`, `engine=mock`, and a demo trusted spec, against the **real Hono app + broker** (no Docker):
1. `POST /previews {specId}` → `201`, `state: "booting"`.
2. Observe SSE `preview` events transition `booting → ready` (capture from the bus).
3. `GET /previews/:id` → `ready` with a `127.0.0.1` `url`.
4. `DELETE /previews/:id` → `204`; SSE `stopped`.
5. Assert `broker.list()` (or `GET /previews`) is **empty** — no leaked previews.
6. Negative: `POST` an **untrusted** spec → `403`; `POST` past `maxConcurrent` → `429`.

## Acceptance check
```
bun test                       # includes preview/e2e-mock + all unit cards (no Docker)
bun run typecheck && bun run lint
# python contract unchanged (Phase 1)
```
Expected: full suite green including the preview E2E; **no Docker required in CI**.

## Out of scope / do NOT do
- Do **not** add the card-38 real-Docker check to CI — mock-first stays the CI path; Docker is verified manually.
- No pixels-lane / neko / spatial / glTF docs beyond "deferred" (ADR-0016).
- Do not document or imply any cloud/public-ingress path — Preview Deck is local-first, `127.0.0.1`-bound.
