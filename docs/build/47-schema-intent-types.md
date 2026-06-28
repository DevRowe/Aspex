# Card 47 — `packages/schema` free-form intent types

## Goal
Add the canonical free-form intent contract to the shared schema package: `IntentSource`, `IntentCandidate`, `IntentRequest`, `IntentResult`, `FreeformConfig`, plus runtime validators. These are the shapes every later Track-A card imports. **Do not touch `types.ts` / the existing `Intent` union** (card 23) — free-form intent **wraps** the existing `Intent`, it does not extend it (ADR-0018/0020).

## Depends on
- Card 02 (`packages/schema` package, `ItemId`, the `validate.ts` helper style).
- Card 23 (the `Intent` union and `VoiceContext` — imported, not modified).

## Files to create
```
packages/schema/src/intent.ts          # the types + validators
packages/schema/test/intent.test.ts    # unit tests
```
## Files to edit
```
packages/schema/src/index.ts           # add: export * from "./intent";
```

## Interfaces / stubs (fill in)
```ts
import type { ItemId, Intent, VoiceContext } from "./index";

// Provenance of a parsed Intent. The gateway tags this; it drives elevate-confirm (ADR-0020).
export type IntentSource = "grammar" | "freeform";

// A compact, enum-ready view of one item the model may reference.
export interface IntentCandidate {
  itemId: ItemId;
  summary: string;        // agent-authored — UNTRUSTED (ADR-0020); fed to the model, never executed
  actions: string[];      // actionIds valid on this item
}

// What the gateway sends the intent service (cards 48/50).
export interface IntentRequest {
  text: string;           // the utterance / typed line the closed grammar returned unknown_command for
  context: VoiceContext;  // selectedId + needsMeIds — the enum source for the constraint
  candidates: IntentCandidate[];
}

// What the intent service returns: an Intent already constrained to the live space.
export interface IntentResult {
  intent: Intent;         // a first-stage Intent, OR { kind:"no_match", reason:"unknown_command" }
  source: "freeform";     // honest provenance for read-back + logging
}

export interface FreeformConfig {
  enabled: boolean;       // default false (ADR-0018)
  endpoints: string[];    // ordered Ollama base URLs (fallback, like sttClient)
  model: string;          // e.g. "llama3.1"
  timeoutMs: number;
  elevateConfirm: boolean; // default true (ADR-0020)
}

// Validate a raw config block into a FreeformConfig (defaults applied, bad input rejected).
export function parseFreeformConfig(raw: unknown): FreeformConfig { /* ... */ }
export function isIntentResult(x: unknown): x is IntentResult { /* ... */ }
```

## Steps
1. Write `intent.ts` with the types above; import `ItemId`, `Intent`, `VoiceContext` from `./index` (do **not** redefine them).
2. Implement `parseFreeformConfig`: default `enabled:false`, `elevateConfirm:true`, `timeoutMs` to the same default the voice config uses; require `endpoints` be a non-empty `string[]` **only when `enabled`**; reject unknown keys following the existing `validate.ts` style/error shape.
3. Implement `isIntentResult` as a type guard (checks `source === "freeform"` and that `intent` is a plausible `Intent` — reuse any existing `Intent` guard from card 23 if present; otherwise a shallow `kind` check).
4. Add `export * from "./intent";` to `index.ts`.
5. Unit tests in `intent.test.ts`: a valid config round-trips; `enabled:true` with empty `endpoints` is rejected; `enabled:false` with no endpoints is accepted (defaults); `elevateConfirm` defaults to `true`; `isIntentResult` narrows a good value and rejects a bare `Intent`.

## Acceptance check
```
cd packages/schema && bun test
```
Expected: new `intent.test.ts` cases pass; existing schema tests (including `voice.test.ts`, `preview.test.ts`) still pass. From the repo root, `bun run typecheck` clean and `bun run lint` clean.

## Out of scope / do NOT do
- **Do NOT modify `types.ts` or the `Intent` union** (card 23). No new `Intent` variant, no `source?` field baked into `Intent` — provenance is tracked by the gateway (card 50), not the type.
- No HTTP, no Ollama, no schema-building logic here (cards 48/49) — types + validators only.
- Do **not** add `confirm` / `dictation_body` / `post` anywhere as model-reachable — that constraint lives in the schema builder (card 49); this card only declares shapes.
- Do not wire any config loading (card 53) — just the `parseFreeformConfig` pure validator.
