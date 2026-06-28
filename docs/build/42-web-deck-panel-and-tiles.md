# Card 42 — Web: Deck panel + preview tiles

## Goal
A dedicated **Deck** panel in the web cockpit that lists live Previews as state-aware tiles, renders a **ready** Preview in a **cross-origin sandboxed iframe** (ADR-0016) with **no Hub credentials**, and offers stop / re-boot / open-in-tab. Subscribes to the SSE `preview` events; hidden when previews are disabled.

## Depends on
- Card 41 (`/previews/*` + SSE `preview`), Card 11 (web scaffold, store, hubClient, SSE handling), Card 36 (types), Card 44 (the client-visible `previews.enabled` flag).

## Files to create
```
apps/web/src/preview/previewClient.ts   # REST calls: listSpecs, listPreviews, boot, stop
apps/web/src/preview/usePreviews.ts      # store slice + SSE 'preview' subscription
apps/web/src/preview/Deck.tsx            # the panel/route
apps/web/src/preview/PreviewTile.tsx     # one tile (state machine + iframe + controls)
```

## Behaviour
- **`usePreviews`:** on mount, `GET /previews/specs` + `GET /previews`; subscribe to the existing SSE stream's `preview` events → upsert `Preview` into the store by `previewId`.
- **`Deck`:** shows a "boot a preview" picker of **trusted** specs and a grid of live tiles. `untrusted` specs render disabled with *"pixels lane not yet available."* The Deck route/nav entry only appears when `previews.enabled` (card 44 flag).
- **`PreviewTile`** state machine:
  - `booting` → spinner + spec name.
  - `ready` → the iframe: `src={preview.url}`, `sandbox="allow-scripts allow-forms allow-same-origin"` (**omit** `allow-top-navigation`/`allow-popups`/`allow-modals`), `referrerPolicy="no-referrer"`, `allow=""`. **Never** pass any Hub token/cookie/query to it.
  - `crashed` → `message` + **Re-boot**.
  - `stopped` → muted + **Re-boot**.
  - Controls: **Stop** (`DELETE /previews/:id`), **Re-boot** (DELETE then `POST /previews {specId}`), **Open in tab** (`window.open(preview.url)`).

## Steps
1. `previewClient` REST wrappers.
2. `usePreviews` store slice + `preview` SSE subscription (reuse card 11's SSE client).
3. `PreviewTile` with the four states + the hardened iframe + controls.
4. `Deck` panel + the trusted-spec boot picker; gate the nav entry on `previews.enabled`.
5. Tests `apps/web/test/preview/*`: tile renders each state; the ready iframe has the exact sandbox attrs and **no** credential in `src`; Stop/Re-boot/Open call the right endpoints (mock fetch); an SSE `preview` event flips a tile's state. Playwright happy-path optional.

## Acceptance check
With `previews.enabled` + `engine=mock` Hub and `bun run dev`:
- Open the Deck → boot a **trusted** spec → tile goes `booting → ready` → the iframe loads the spec's url.
- **Stop** → `stopped`; **Re-boot** → fresh `ready`; **Open in tab** opens the url.
- An **untrusted** spec is shown **non-bootable**.
- (Unit: iframe sandbox attrs asserted; no Hub credential reaches the iframe.)

## Out of scope / do NOT do
- No pixels/neko lane, no `<video>` streaming, no postMessage protocol (ADR-0016 — deferred).
- No spatial/WebXR, no `<Canvas>`, no glTF (Spatial Shell track).
- Do not render an `untrusted` spec in an iframe; do not inject the Hub token/cookie into any iframe (guardrail 16).
- Do not parse, scrape, or interpret the preview's DOM/content (guardrail 14 — pixels/sandbox only).
- Do not treat a Preview as world-model state (ADR-0015) — it lives only in the preview store slice.
