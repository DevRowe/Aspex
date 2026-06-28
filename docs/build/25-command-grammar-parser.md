# Card 25 — Command grammar parser (pure, safety-critical)

## Goal
A **pure function** that turns a `Transcript` + `VoiceContext` + the selected Item's `actions` (and the current `VoiceSession`) into an `Intent`. This is the closed-vocabulary grammar (ADR-0011) and the place the safe-grammar invariants are enforced. No I/O, no dispatch — just `(input) => Intent`. Table-tested to death.

## Depends on
- Card 23 (voice types). Card 02 (`Action`, `ItemId`).

## Files to create
```
apps/hub/src/voice/grammar.ts
apps/hub/test/grammar.test.ts
```

## Interfaces / stubs

```ts
import type { Action, ItemId } from "@aspex/schema";
import type { Transcript, VoiceContext, VoiceSession, Intent } from "@aspex/schema";

export interface ParseInput {
  transcript: Transcript;
  context: VoiceContext;
  session: VoiceSession;                          // pending-confirm / dictation state (card 26 owns transitions)
  selectedActions: Action[];                      // actions on the selected Item (Hub looks them up)
  resolveProject: (name: string) => ItemId | "ambiguous" | null;  // injected; matches against the world-model
  confidenceThreshold: number;                    // from config (card 33)
}

// THE pure entry point.
export function parse(input: ParseInput): Intent;
```

### Rules (implement exactly — these are the ADR-0011 invariants)
1. **Dictation mode wins.** If `session.dictating` is set:
   - "post it" / "send it" → `{ kind: "post" }`.
   - "cancel" / "never mind" → `{ kind: "cancel" }`.
   - **anything else** → `{ kind: "dictation_body", text: transcript.text }` (verbatim, NOT parsed as a command).
   - (Confidence gate still applies — see rule 2.)
2. **Confidence gate.** If `transcript.confidence < confidenceThreshold` → `{ kind: "no_match", heard, reason: "low_confidence" }`. (Applies in every mode.)
3. **Pending confirm.** If `session.pendingConfirm` is set and the transcript is "confirm ‹verb›" matching `pendingConfirm.actionId`'s verb → `{ kind: "confirm", itemId, actionId }`. A non-matching utterance does **not** fire it (falls through to normal parsing; card 26 decides whether it clears the pending confirm).
4. **Navigation** (no referent needed): "what needs me" → `nav { show_needs_me }`; "next"/"previous" → `nav { move ±1 }`. "focus ‹project›" → `resolveProject`: hit → `nav { select id }`; `"ambiguous"` → `no_match` reason `ambiguous`; `null` → `no_match` reason `no_referent`.
5. **Selected-referent commands** ("read it", "open it", "approve", "re-run", "merge", "comment", "request changes"/"reject"): require `context.selectedId`. Missing → `no_match` reason `no_referent`.
   - "read it" → `read`; "open it" → `open`.
   - action verbs map to an action id: `approve`→`approve`, `re-run`→`rerun`, `merge`→`merge`, `comment`→`comment`, `request changes`/`reject`→`request_changes`.
   - **The action must exist in `selectedActions`.** If not → `no_match` reason `action_unavailable`.
   - `comment` / `request_changes` → `{ kind: "dictate", itemId, actionId }`. Others → `{ kind: "action", itemId, actionId }`. (The state machine, card 26, decides arm-vs-fire from `requiresConfirmation`.)
6. **Fallthrough** → `{ kind: "no_match", heard: transcript.text, reason: "unknown_command" }`.

Normalize the transcript first: lowercase, trim, collapse whitespace, strip trailing punctuation. Keep a `VERBS` table (verb → actionId + synonyms) defined once.

## Steps
1. Write the normalizer + the `VERBS` / nav-phrase tables.
2. Implement `parse` following rules 1–6 **in that order** (dictation and confidence gates first).
3. Make `resolveProject` injected (no world-model import here — keep pure).
4. Write table-driven tests for every row of the grammar table in the index **and** every `no_match` reason.

## Acceptance check
```bash
bun test apps/hub/test/grammar.test.ts     # green
```
Tests must prove (the safe-grammar invariants):
- "blah blah" with high confidence → `no_match` / `unknown_command`; **no action kind ever returned**.
- "merge" when `selectedActions` has no merge → `no_match` / `action_unavailable` (not an `action`).
- "merge" when merge exists → `{ kind: "action", actionId: "merge" }` (arming is card 26's job, NOT here).
- "approve" with `selectedId` undefined → `no_match` / `no_referent`.
- confidence below threshold on a perfectly valid "approve" → `no_match` / `low_confidence`.
- with `session.dictating` set: "merge the database" → `dictation_body` (verbatim), **not** an action; "post it" → `post`.
- "focus atlas" where `resolveProject` returns `"ambiguous"` → `no_match` / `ambiguous`.
- "confirm merge" with a matching `pendingConfirm` → `confirm`; with no pending confirm → `no_match` (unknown_command).

## Out of scope / do NOT do
- **No dispatch, no STT, no TTS, no HTTP, no mutation of session.** This is a pure parser; the state machine (card 26) transitions session and the orchestrator (card 27) acts.
- Do not import the world-model or Octokit — `resolveProject` is injected.
- Do not add new grammar beyond the index table (no free-form intent — that's Phase 3).
- Do not decide arm-vs-fire for confirmable actions here — emit `action`; card 26 reads `requiresConfirmation`.
