# Card 36 — `packages/schema` preview types

## Goal
Add the canonical Preview contract to the shared schema package: `PreviewSpec`, `Preview`, `PreviewState`, `PreviewTrust`, `PreviewEngineKind`, plus runtime validators. These are the shapes every later Preview-Deck card imports. **Do not touch `types.ts` / `AttentionItem`** — a Preview is not an Item (ADR-0015).

## Depends on
- Card 02 (`packages/schema` package, `ItemId`, the `validate.ts` helper style).

## Files to create
```
packages/schema/src/preview.ts        # the types + validators
```
## Files to edit
```
packages/schema/src/index.ts          # add: export * from "./preview";
```

## Interfaces / stubs (fill in)
```ts
import type { ItemId } from "./index";

export type PreviewTrust = "trusted" | "untrusted";
export type PreviewState = "booting" | "ready" | "crashed" | "stopped";
export type PreviewEngineKind = "docker" | "compose" | "mock";

export interface PreviewSpec {
  id: string;
  name: string;
  engine: PreviewEngineKind;
  image?: string;            // exactly one of image | composeFile (pull-not-build, ADR-0014)
  composeFile?: string;
  port: number;
  trust: PreviewTrust;
  itemId?: ItemId;
  env?: Record<string, string>;
  limits?: { cpus?: string; memory?: string; idleTtlSec?: number };
}

export interface Preview {
  previewId: string;
  specId: string;
  state: PreviewState;
  trust: PreviewTrust;
  url?: string;
  startedAt: string;
  expiresAt?: string;
  message?: string;
}

// Validate a raw config entry into a PreviewSpec (throws/returns errors on bad input).
export function parsePreviewSpec(raw: unknown): PreviewSpec { /* ... */ }
// Type guard for narrowing.
export function isPreviewSpec(x: unknown): x is PreviewSpec { /* ... */ }
```

## Steps
1. Write `preview.ts` with the types above and re-export `ItemId` usage from `./index`.
2. Implement `parsePreviewSpec`: assert `id`/`name`/`port`/`trust`/`engine` present and typed; enforce **exactly one** of `image`/`composeFile`; reject unknown `engine`/`trust` values; default `limits` to `{}` if absent. Follow the existing `validate.ts` style (same error shape as the Phase 0 validators).
3. Implement `isPreviewSpec`.
4. Add `export * from "./preview";` to `index.ts`.
5. Unit tests in `packages/schema/test/preview.test.ts`: valid spec round-trips; both-image-and-compose rejected; neither rejected; bad `trust`/`engine` rejected; `itemId`/`env`/`limits` optional.

## Acceptance check
```
cd packages/schema && bun test
```
Expected: new `preview.test.ts` cases pass; existing schema tests still pass. `bun run typecheck` clean. `bun run lint` clean.

## Out of scope / do NOT do
- **Do NOT modify `types.ts` or `AttentionItem`** (ADR-0015 — no `preview?` field on the Item; previewability is a client cross-reference, card 43).
- No engine logic, no Docker, no HTTP, no broker — types + validators only.
- No `env` secret handling beyond a doc comment that `env` must never carry secrets.
- Do not add `untrusted`-bootability anywhere — the type exists, but gating lives in the registry/broker (cards 39/40).
