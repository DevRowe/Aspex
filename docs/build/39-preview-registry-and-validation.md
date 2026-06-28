# Card 39 — Preview registry + spec validation

## Goal
Turn the raw `previews.specs` config array into a validated, queryable **registry**: parse each entry via `parsePreviewSpec` (card 36), skip-and-report invalid ones (a bad spec must never crash the Hub), reject duplicate ids, and expose lookup by id and by `itemId`. This provides the `lookupSpec` the broker (card 40) needs and the spec list the HTTP layer (card 41) serves.

## Depends on
- Card 36 (`parsePreviewSpec`, `PreviewSpec`, `ItemId`), Card 09 (config loading style).

## Files to create
```
apps/hub/src/preview/registry.ts
```

## Interfaces / stubs (fill in)
```ts
import type { PreviewSpec, ItemId } from "@aspex/schema";

export interface PreviewRegistry {
  list(): PreviewSpec[];
  get(specId: string): PreviewSpec | undefined;
  byItem(itemId: ItemId): PreviewSpec[];          // client cross-reference (cards 41/43)
}
export interface RegistryError { index: number; specId?: string; message: string }

export function loadPreviewRegistry(rawSpecs: unknown[]): {
  registry: PreviewRegistry;
  errors: RegistryError[];                          // skipped invalid / duplicate entries
}
```

## Behaviour
- Iterate `rawSpecs`; `parsePreviewSpec` each. On parse failure → push a `RegistryError` (with index + message), **skip** the entry.
- **Duplicate id** → keep the first, push a `RegistryError` for the later one (don't silently overwrite).
- Valid specs go into an id-keyed map. `list()` returns them in config order; `get` is map lookup; `byItem` filters those whose `itemId === itemId`.
- The registry is **immutable** after load (rebuilt only on a config reload). It carries the `trust` field but makes **no bootability decision** — gating lives in the broker (card 40).

## Steps
1. `loadPreviewRegistry`: parse + collect errors + dedupe.
2. `PreviewRegistry` over an internal `Map`.
3. Tests `apps/hub/test/preview/registry.test.ts`: all-valid loads in order; one invalid skipped + reported (others still load); duplicate id reported once; `get`/`byItem` correct; empty input → empty registry, no errors.

## Acceptance check
```
cd apps/hub && bun test test/preview/registry.test.ts
```
Expected: all cases pass with **no Docker**. `bun run typecheck` + `bun run lint` clean.

## Out of scope / do NOT do
- No booting, no engine, no Docker, no HTTP.
- **No trust gating here** — the registry holds `trusted` and `untrusted` specs alike; the broker refuses to boot `untrusted` (card 40, ADR-0016).
- Do not fetch or compute specs from adapters or repos (ADR-0014 — registry reads declared config only; adapter-surfacing is a future [[Provision]]-style extension).
