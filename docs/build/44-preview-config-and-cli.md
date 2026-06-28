# Card 44 — Preview config + CLI

## Goal
Add the `previews` config section, wire the engine + registry + broker + routes into the Hub bootstrap **only when enabled**, expose `previews.enabled` to the client (so the Deck hides itself), and add `aspex preview check` / `aspex preview list`. Extends card 09. Engine availability degrades gracefully (ADR-0017).

## Depends on
- Card 09 (config + CLI + Hub bootstrap), Card 39 (registry), Card 37/38 (engines + `available()`), Card 40 (broker), Card 41 (routes), Card 36 (`parsePreviewSpec`).

## Files to edit
```
apps/hub/src/config.ts     # previews section + defaults + validation
apps/hub/src/cli.ts        # `preview check` / `preview list` subcommands
apps/hub/src/<bootstrap>   # construct engine+registry+broker+routes when enabled (where card 07/09 wires the Hub)
```

## Config shape (defaults)
```ts
previews: {
  enabled: false,                 // opt-in (ADR-0017)
  engine: "docker",               // "docker" | "mock"
  maxConcurrent: 3,
  limits: { cpus: "1", memory: "512m", idleTtlSec: 600 },
  specs: [],                      // PreviewSpec[] (validated via registry, card 39)
}
```

## Behaviour
- **Load + validate:** build the registry from `previews.specs` (card 39); log skipped invalid specs honestly; never crash on a bad spec.
- **Wire (enabled only):** pick the engine (`mock` or `docker`); if `engine.available()` is false → log *"previews enabled but engine unavailable"*, leave routes unmounted (Deck stays hidden). If available → run `engine.sweep?.()` (clear orphans, card 38), construct the broker (card 40) with `maxConcurrent`/`limits`, mount the routes (card 41), and register `broker.shutdown()` on Hub shutdown.
- **Expose the flag:** add `previews.enabled` (and optionally live/max counts) to the existing `/config` (or `/health`) endpoint the web client reads, so card 42/43 can hide the Deck/affordance.
- **`aspex preview check`:** load config → `engine.available()` → validate registry → print a table: each spec `id`, `trust`, and **bootable?** (`trusted` + engine available) or the reason not. Exit 0 always; report clearly (parity with `aspex voice check`).
- **`aspex preview list`:** `GET /previews` on the running Hub → print live previews (id, spec, state, url).

## Steps
1. Extend the config schema + defaults + validation.
2. Bootstrap wiring with the `available()` gate + `sweep` + shutdown hook.
3. Expose `previews.enabled` on `/config`.
4. `preview check` + `preview list` CLI.
5. Tests: config defaults/validation; `preview check` against the **mock** engine lists demo specs as bootable; `enabled:false` reports disabled; an unavailable engine reports the reason (inject a fake `available()=false`).

## Acceptance check
```
cd apps/hub
ASPEX_PREVIEWS_ENABLED=1 bun run src/cli.ts preview check --engine mock
```
Expected: prints each demo spec with `trusted → bootable`, `untrusted → not bootable (pixels lane n/a)`. With previews disabled → "previews disabled". `bun run typecheck` + `bun run lint` clean.

## Out of scope / do NOT do
- No `preview boot` / `preview stop` CLI — booting is the cockpit's job (explicit user action, ADR-0015).
- No secrets in `specs[].env` (document); keep config/token/DB in `~/.aspex` (outside the repo).
- Do not require Docker — absent/unavailable engine must degrade, not crash (ADR-0017).
- Do not mount the routes when disabled or when the engine is unavailable.
