# Card 23 — `packages/schema` voice types (the shared voice contract)

## Goal
Add the **pure types + validators** for the voice loop to the existing `packages/schema`, so the Hub and web client share one contract: `VoiceContext`, `Transcript`, `Intent`, `NoMatchReason`, `ClientDirective`, `VoiceSession`, `VoiceResult`. No I/O — this stays a leaf, pure package.

## Depends on
- Card 02 (schema: `ItemId`, `Action`). Phase 0 must be present.

## Files to create
```
packages/schema/src/voice.ts          # all voice types from the index voice contract
packages/schema/test/voice.test.ts
```
Plus: re-export `./voice` from `packages/schema/src/index.ts`.

## Interfaces / stubs to fill in

**`voice.ts`** — copy the voice contract block verbatim from `22-phase-1-index.md` ("The canonical voice contract"): `VoiceContext`, `Transcript`, `Intent` (the full discriminated union), `NoMatchReason`, `ClientDirective`, `VoiceSession`, `VoiceResult`.

Add two small validators/guards (mirroring `validate.ts`):
```ts
import type { VoiceContext, ClientDirective } from "./voice";

// Body of POST /voice/utterance carries the context as a JSON field alongside the audio.
export function isValidVoiceContext(x: unknown): x is VoiceContext { /* needsMeIds is string[]; selectedId optional string */ }
export function assertVoiceContext(x: unknown): asserts x is VoiceContext { /* throw if invalid */ }

// Narrowing helper used by the web directive-applier (card 32) and tests.
export function isDirective(x: unknown): x is ClientDirective { /* type in {select,move,show_needs_me,none} + shape */ }
```

## Steps
1. Write `voice.ts` with the exact type names/shapes from the index. Keep `Intent` a discriminated union on `kind`.
2. Implement `isValidVoiceContext` / `assertVoiceContext` / `isDirective` (define the allowed-value arrays once, reuse).
3. Re-export from `index.ts`.
4. Write `voice.test.ts`.

## Acceptance check
```bash
bun test packages/schema/test/voice.test.ts     # all green
bun run --filter @aspex/schema typecheck         # 0 errors
```
Tests must cover:
- `isValidVoiceContext({ needsMeIds: ["github:pr:o/r#1"] })` → true; `{ needsMeIds: "x" }` → false.
- `assertVoiceContext(bad)` throws.
- `isDirective({ type: "select", id: "x" })` → true; `{ type: "nope" }` → false.
- A `const x: Intent = { kind: "no_match", heard: "blah", reason: "unknown_command" }` typechecks; an `Intent` with a bogus `kind` does **not** (compile-time check — keep it in a `// @ts-expect-error` test).

## Out of scope / do NOT do
- No parsing, no STT/TTS, no HTTP, no session logic — only types + the three guards. The parser is card 25; the session machine is card 26.
- Do not import from `apps/` — `schema` stays a leaf.
- Do not change any Phase 0 type. This card is additive only.
- Do not add runtime deps.
