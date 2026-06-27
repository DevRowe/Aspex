# Card 02 — `packages/schema` (the shared contract)

## Goal
Implement the canonical types and **pure helper functions** that every other package imports: `AttentionItem`, `Signal`, `Adapter`, the enums, stable-id builders, and a Signal validator. No I/O, no side effects — this package is pure.

## Depends on
- Card 01 (monorepo scaffold).

## Files to create
```
packages/schema/src/types.ts        # all types/enums from the index schema
packages/schema/src/ids.ts          # id builders + parsers
packages/schema/src/adapter.ts      # Adapter + Action result interfaces
packages/schema/src/validate.ts     # isValidSignal(), assertSignal()
packages/schema/src/index.ts        # re-export everything
packages/schema/test/ids.test.ts
packages/schema/test/validate.test.ts
```

## Interfaces / stubs to fill in

**`types.ts`** — copy the schema block verbatim from `00-index.md` ("The canonical schema"): `Source`, `ItemId`, `State`, `Liveness`, `Severity`, `Risk`, `Reason`, `Action`, `Evidence`, `AttentionItem`, `Signal`.

**`ids.ts`**:
```ts
import type { ItemId } from "./types";

// Builders — the ONLY way ids are made. Keeps upsert keys consistent (ADR-0001).
export const githubPrId = (repo: string, number: number): ItemId =>
  `github:pr:${repo}#${number}`;                       // repo = "owner/name"
export const claudeSessionId = (sessionId: string): ItemId =>
  `claude-code:session:${sessionId}`;
export const webhookId = (key: string): ItemId => `webhook:${key}`;

// Parser — returns { source, kind, rest } or null if malformed.
export function parseItemId(id: ItemId):
  | { source: string; kind: string; rest: string }
  | null { /* split on first two ":" */ }
```

**`adapter.ts`**:
```ts
import type { AttentionItem, Signal, Action } from "./types";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface Adapter {
  id: string;                                    // e.g. "github"
  start(ctx: AdapterContext): Promise<void>;
  listActions(itemId: string): Action[];
  runAction(itemId: string, actionId: string, payload?: unknown): Promise<ActionResult>;
  stop(): Promise<void>;
}

export interface AdapterContext {
  emit(signal: Signal): void;     // upserts an Item into the world-model
  heartbeat(source: string): void; // refreshes liveness without changing state (ADR-0003)
  log(msg: string): void;
}
```

**`validate.ts`**:
```ts
import type { Signal } from "./types";
export function isValidSignal(x: unknown): x is Signal { /* check id, source, state present + enum membership */ }
export function assertSignal(x: unknown): asserts x is Signal { /* throw if !isValidSignal */ }
```

## Steps
1. Write `types.ts` from the index schema (exact field names).
2. Implement `ids.ts` builders + `parseItemId`.
3. Implement `adapter.ts` interfaces.
4. Implement `validate.ts` with enum membership checks (define the allowed-value arrays once and reuse).
5. Re-export all from `index.ts`.
6. Write the two test files.

## Acceptance check
```bash
bun test packages/schema     # all green
bun run --filter @aspex/schema typecheck   # 0 errors
```
Tests must cover:
- `githubPrId("o/r", 42) === "github:pr:o/r#42"` and `parseItemId` round-trips it.
- `isValidSignal({ id, source: "github", state: "needs_review" })` → true.
- `isValidSignal({ id, source: "nope", state: "x" })` → false.
- `assertSignal(bad)` throws.

## Out of scope / do NOT do
- No storage, no HTTP, no ranking, no liveness *logic* (only the type + the `heartbeat` signature live here). Ranking is card 05; liveness is card 06.
- Do not import anything from `apps/` — `schema` is a leaf dependency.
- Do not add runtime deps; this package is types + pure functions only.
