# Card 49 — Constrained-Intent JSON-Schema builder (the safety core)

## Goal
A **pure** function that, given the live [[Voice context]] and the selected Item's actions, builds the **JSON Schema** handed to Ollama's `format` parameter so the model's output is **provably a first-stage `Intent` over the live space** — by construction, not by post-hoc validation (ADR-0019/0020). This is the single most security-critical card in Phase 3: it is what makes a prompt-injected or hallucinating model **harmless**. No network, no LLM, no I/O — just data in, schema out.

## Depends on
- Card 23 (the `Intent` union — the schema must mirror its **first-stage** variants only).
- Card 47 (`IntentRequest` / `IntentCandidate` — the input shape).

## Files to create
```
apps/hub/src/voice/intentSchema.ts        # the pure builder
apps/hub/test/intentSchema.test.ts         # unit tests
```

## Interfaces / stubs (fill in)
```ts
import type { ItemId } from "@aspex/schema";

// A minimal JSON-Schema value (object) — enough for Ollama's `format`. Keep it a plain serializable record.
export type JsonSchema = Record<string, unknown>;

export interface SchemaInput {
  needsMeIds: ItemId[];          // ordered needs-me ids (from voice-context)
  selectedId?: ItemId;           // the current selection, if any
  selectedActions: string[];     // actionIds valid on the selected item (may be empty)
}

// Build a JSON Schema constraining the model to ONE first-stage Intent over the live space.
export function buildIntentSchema(input: SchemaInput): JsonSchema { /* ... */ }
```

## What the schema must permit — and must NOT
The schema is a **`oneOf`** over exactly these branches (mirror the `Intent` union's first-stage members only):

| Branch | Constrained fields | Notes |
|---|---|---|
| `action` | `itemId` ∈ **enum(selectedId ∪ needsMeIds)**, `actionId` ∈ **enum(selectedActions)** | *arms* an action; never fires it |
| `dictate` | `itemId` ∈ enum(...), `actionId` ∈ enum(selectedActions ∩ {`comment`,`request_changes`}) | enters dictation mode (the body is captured deterministically later) |
| `nav` | `directive` ∈ {`show_needs_me`, `move ±1`, `select id∈enum(...)`} | navigation/query |
| `read` / `open` | `target` ∈ enum(selectedId ∪ needsMeIds) | |
| `no_match` | `reason` const `"unknown_command"` | the model's **abstain** branch — it MUST be able to decline |

**The schema MUST NOT contain** `confirm`, `dictation_body`, or `post` branches (those are deterministic two-step states the model can never reach — ADR-0020), and MUST NOT allow a free-string `itemId`/`actionId` (every reference is an `enum`, never `type:"string"`).

## Steps
1. Compute the id enum: `dedupe([...(selectedId ? [selectedId] : []), ...needsMeIds])`. If it is **empty**, the only valid `itemId`-bearing branches are dropped; the schema still always includes `nav: show_needs_me` and `no_match`.
2. Compute the action enum from `selectedActions`. If empty, drop the `action`/`dictate` branches entirely (the model can still `nav`/`read`/`open`/`no_match`).
3. Build the `oneOf` per the table; every id/action field is `{ "enum": [...] }`, every fixed discriminator is `{ "const": ... }`. Set `"additionalProperties": false` on every branch.
4. Return the plain object. Keep it deterministic (stable key order) so tests can assert on it and so it caches cleanly.
5. Tests in `intentSchema.test.ts` must prove the **negative** guarantees, not just the happy path:
   - No branch anywhere has `kind` ∈ {`confirm`,`dictation_body`,`post`}.
   - Every `itemId`/`actionId`/`target` is an `enum`, never a bare `{type:"string"}` (assert no string-typed id field exists — walk the schema).
   - `action`/`dictate` enums contain **only** ids from `needsMeIds ∪ selectedId` and actions from `selectedActions` (an action not on the selected item is absent).
   - Empty `needsMeIds` + no `selectedId` → schema still valid, only `show_needs_me` + `no_match` reachable.
   - `no_match` branch is **always** present (the model can always abstain).

## Acceptance check
```
bun test apps/hub/test/intentSchema.test.ts   # green
```
Plus `bun run typecheck` and `bun run lint` clean from the repo root. The decisive assertions are the negative ones in step 5 — a reviewer should be able to read the test and conclude *the model cannot emit anything outside the live Intent space*.

## Out of scope / do NOT do
- **No network, no Ollama, no `fetch`** — this card is pure. Calling the model is card 48; wiring it is card 50.
- Do **not** validate the model's *response* here (that belongs to card 48/50, and with constrained decoding it should already conform). This card only **produces the constraint**.
- Do not emit GBNF text — Ollama compiles the JSON Schema to GBNF internally (ADR-0019). We hand it a JSON Schema, nothing lower-level.
- Do not include `confirm`/`dictation_body`/`post` "for completeness" — their absence is the safety property (ADR-0020).
