# Card 57 — Wire the new adapters + ownership

## Goal
Register **codex / opencode / cursor** in the `AdapterRegistry`, extend the source→adapter map (card 08), add per-adapter enable config, and **enforce the ADR-0002 ownership partition** — these adapters emit only **agent-local** state and never claim PR-lifecycle attention (that stays the github adapter's). After this card the three Sources are live behind their config flags.

## Depends on
- Cards 54 (codex), 55 (opencode), 56 (cursor), Card 08 (`AdapterRegistry`, the source→adapter constant map), Card 09 (`config.ts`, `boot.ts`).

## Files to edit
```
apps/hub/src/config.ts                 # add AdaptersConfig
apps/hub/src/boot.ts                   # construct + register each enabled adapter
apps/hub/src/adapters/registry.ts      # extend the source->adapter map (add opencode, cursor; codex now backed)
apps/hub/test/registry.test.ts         # extend
apps/hub/test/adapters-ownership.test.ts  # new: the partition guard
```

## Config (additive to `AspexConfig`)
```ts
export interface AdaptersConfig {
  codex?: { enabled: boolean };                                  // notify→relay; default false
  opencode?: { enabled: boolean; serverUrl: string; directory?: string };  // SSE; default false
  cursor?: { enabled: boolean; secret?: string };                // signed webhook; default false
}
// AspexConfig gains:  adapters?: AdaptersConfig;
```
- Defaults: each absent/`enabled:false`. Validate `opencode.serverUrl` is a non-empty URL when enabled; `cursor.secret` required when `cursor.enabled` (fail-closed, card 56).
- Env overrides (optional, mirror the pattern): `ASPEX_ADAPTERS_OPENCODE_URL`, etc.

## Boot wiring (`boot.ts`)
```ts
if (cfg.adapters?.codex?.enabled)    registry.register(new CodexAdapter());
if (cfg.adapters?.opencode?.enabled) registry.register(new OpenCodeAdapter(cfg.adapters.opencode));
if (cfg.adapters?.cursor?.enabled)   registry.register(new CursorAdapter(cfg.adapters.cursor)); // also mounts /webhooks/cursor (card 56)
```

## Source→adapter map (`registry.ts`)
Extend the card-08 constant map: `github→github`, `claude-code→claude-code`, `webhook→webhook`, `codex→codex`, **`opencode→opencode`**, **`cursor→cursor`**. (`codex` was a placeholder in card 08 — it's now backed by a real adapter.)

## Ownership guard (ADR-0002)
The new adapters must **only** emit agent-local reasons (`blocked_on_human`, `errored`, or Ambient `working`/`done`). They must **never** emit a PR-lifecycle reason (`review_requested`, `failing_ci`, `awaiting_merge`) — those belong to github, so one unit of work never glows twice. Add a test asserting that across each adapter's fixtures, no emitted Signal carries a PR-lifecycle reason.

## Steps
1. Add `AdaptersConfig` + defaults + validation (`opencode.serverUrl`, `cursor.secret` fail-closed).
2. Construct + register each enabled adapter in `boot.ts`.
3. Extend the source→adapter map.
4. Tests: routing (an `opencode:session:x` itemId routes to the opencode adapter; same for codex/cursor); the ownership partition guard; each-disabled → not registered.

## Acceptance check
```bash
bun test apps/hub/test/registry.test.ts apps/hub/test/adapters-ownership.test.ts   # green
```
Tests must prove:
- `dispatchAction("opencode:session:1", ...)` routes to the opencode adapter (and likewise codex/cursor) — which then returns the **observe-only refusal** (no control).
- With all three disabled, none are registered; the Hub boots unchanged.
- The ownership guard: no new-adapter fixture Signal carries a PR-lifecycle reason (ADR-0002).
- An integration boot with all three enabled (mock/fixtures) lands Items with **agent-local** reasons only.

## Out of scope / do NOT do
- **No control actions** — registration does not add any (observe-only, ADR-0021).
- Do not change the github adapter's ownership or let a new adapter set PR-lifecycle attention.
- Do not enable any adapter by default.
- Do not mount `/webhooks/cursor` when cursor is disabled (card 56 owns that gate).
