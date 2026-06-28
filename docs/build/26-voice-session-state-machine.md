# Card 26 — Voice session state machine (pure)

## Goal
A **pure reducer** that owns the only stateful part of voice: the **pending confirm** (arm → fire/expire) and **dictation mode** (enter → capture body → post/cancel). Given the current `VoiceSession` + an `Intent` (from card 25) + action metadata, it returns the next session and a declarative **effect** for the orchestrator to perform. This is where "arm vs fire" is decided. No I/O.

## Depends on
- Card 23 (`VoiceSession`, `Intent`), Card 25 (produces `Intent`), Card 02 (`Action`).

## Files to create
```
apps/hub/src/voice/session.ts
apps/hub/test/session.test.ts
```

## Interfaces / stubs
```ts
import type { VoiceSession, Intent, ItemId, NoMatchReason } from "@aspex/schema";

export type Effect =
  | { kind: "dispatch"; itemId: ItemId; actionId: string; payload?: unknown }   // confirmed:true added by orchestrator if needed
  | { kind: "navigate"; directive: import("@aspex/schema").ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "armed"; itemId: ItemId; actionId: string; label: string }          // ask for confirm-phrase
  | { kind: "dictation_prompt"; itemId: ItemId; actionId: string }              // "dictate your comment…"
  | { kind: "dictation_readback"; itemId: ItemId; actionId: string; body: string } // echo + ask to post
  | { kind: "noMatch"; reason: NoMatchReason; heard?: string }
  | { kind: "cancelled" }
  | { kind: "none" };

export interface ReduceMeta {
  now: number;
  confirmTtlMs: number;
  requiresConfirmation: (itemId: ItemId, actionId: string) => boolean;   // from the Item's Action
  actionLabel: (itemId: ItemId, actionId: string) => string;
}

export function reduce(session: VoiceSession, intent: Intent, meta: ReduceMeta): { next: VoiceSession; effect: Effect };
```

### Reducer rules (implement exactly)
1. **Expiry first.** If `session.pendingConfirm` exists and `now - armedAt > confirmTtlMs`, treat it as already cleared before handling `intent`.
2. `intent.kind === "action"`:
   - if `requiresConfirmation(item, action)` → `next.pendingConfirm = { item, action, label, armedAt: now }`, effect `armed`. **No dispatch.**
   - else → effect `dispatch`, `next` clears pendingConfirm.
3. `intent.kind === "confirm"`: if it matches `pendingConfirm` → effect `dispatch` (the orchestrator adds `confirmed:true`), clear pendingConfirm. If no/again mismatched pending confirm → effect `noMatch` (`unknown_command`).
4. `intent.kind === "dictate"` → `next.dictating = { item, action }`, effect `dictation_prompt`. (Clear any pendingConfirm.)
5. `intent.kind === "dictation_body"` (only arrives while dictating, enforced by card 25) → keep `dictating`, stash the body on the session (`dictating.pendingBody`), effect `dictation_readback`.
6. `intent.kind === "post"`: if `dictating.pendingBody` present → effect `dispatch` with `payload: { body }` (+ `confirmed:true`), clear `dictating`. Else effect `noMatch`.
7. `intent.kind === "cancel"` → clear `pendingConfirm` and `dictating`, effect `cancelled`.
8. `nav`/`read`/`open` → pass through to the matching effect; **any other pending confirm is cleared** (a new command abandons an un-confirmed dangerous action — safe default).
9. `no_match` → effect `noMatch` carrying the reason; **session unchanged** (a mis-hear must not clear an armed confirm — but rule 8 only clears on a *recognised* different command).

Extend `VoiceSession.dictating` with an optional `pendingBody?: string` (add to card 23's type via this card if not already there — keep it additive).

## Steps
1. Implement `reduce` following rules 1–9 in order; return a **new** session object (never mutate input).
2. Keep it total — every `Intent.kind` handled.
3. Table-driven tests.

## Acceptance check
```bash
bun test apps/hub/test/session.test.ts     # green
```
Tests must prove:
- `action` merge with `requiresConfirmation=true` → effect `armed`, `next.pendingConfirm` set, **no dispatch effect**.
- then `confirm` matching → effect `dispatch`, pendingConfirm cleared.
- `confirm` with no pending → `noMatch`.
- pendingConfirm older than `confirmTtlMs` + a `confirm` → `noMatch` (expired).
- `action` approve with `requiresConfirmation=false` → effect `dispatch` immediately.
- `dictate` comment → `dictation_prompt`, `dictating` set; then `dictation_body "looks good"` → `dictation_readback` with that body, still dictating; then `post` → `dispatch` with `payload.body==="looks good"`, dictating cleared.
- a recognised `nav` while a confirm is armed → confirm cleared (rule 8); a `no_match` while armed → confirm **retained** (rule 9).

## Out of scope / do NOT do
- No STT/TTS/HTTP/dispatch — the orchestrator (27) performs effects; this only decides them.
- Do not read `requiresConfirmation` from anywhere but `meta` (keep pure/injected).
- Do not parse transcripts here (that's card 25) — you receive `Intent`.
- Do not add `confirmed:true` to the dispatch effect here — the orchestrator does that (keeps the confirm contract in one place).
