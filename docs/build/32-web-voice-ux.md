# Card 32 — Web: voice UX (feedback, read-back, directives, dictation)

## Goal
Make the voice loop legible and safe on screen: staged feedback (never blank — guardrail 13), the read-back text, applying the Hub's `ClientDirective` to selection, the dictation-mode affordance, error/timeout surfacing, and a voice on/off toggle. This is the visible half of ADR-0011's "the client renders what comes back."

## Depends on
- Card 31 (capture + `VoiceResult`), Card 12 (`selectedId`, Inbox), Card 13 (detail), Card 23 (`VoiceResult`, `VoiceSession`, `ClientDirective`).

## Files to create
```
apps/web/src/voice/voiceStore.ts        # voice slice: phase, lastReadback, session, error, enabled
apps/web/src/voice/applyDirective.ts     # ClientDirective -> store mutation
apps/web/src/components/VoiceHud.tsx      # the persistent status line + read-back
apps/web/src/components/VoicePrompt.tsx    # confirm / dictation prompt affordance
```

## Behaviour
- **Staged feedback (`phase`):** `idle → listening` (while held) `→ transcribing` (after release, awaiting `VoiceResult`) `→ acting` (if a dispatch is happening) `→ result`. Always show *something*; the HUD reflects each phase. A request that doesn't return within the timeout → `error` phase with an honest message.
- **Read-back:** show `VoiceResult.readback` text persistently in the HUD (audio plays via card 31). Distinguish `ok:false` (rejection / no-match / error) visually from success — calm, not alarming.
- **Directive application (`applyDirective`):**
  - `select{id}` → set `selectedId` (reuses card 12/13 selection — so "focus AtlasCore" opens that Item's detail).
  - `move{delta}` → move `selectedId` ±1 within the current `needsMe` order.
  - `show_needs_me` → ensure the needs-me view is visible/scrolled to top.
  - `none` → nothing.
- **Session mirror (`VoicePrompt`):** when `VoiceResult.session.pendingConfirm` is set, show "Say 'confirm ‹verb›'" (mirrors the spoken prompt — and a visible reminder of what's armed). When `session.dictating` is set, show a "Dictating ‹comment/changes›… say 'post it'" affordance, and after the body read-back show the captured text awaiting "post it". Clear when the session clears.
- **Voice on/off toggle:** a control bound to `voiceStore.enabled`; when off, PTT (card 31) is inert and the HUD shows "Voice off". Persist the toggle (localStorage).
- **Mic-permission error:** if capture reported a permission error (card 31), the HUD shows how to fix it (and, in Tauri, points at the app mic permission).

## Steps
1. `voiceStore` slice (or extend the card-11 store) with `phase`, `lastReadback`, `session`, `error`, `enabled`.
2. `applyDirective` pure mapping + tests.
3. `VoiceHud` (always-visible status + read-back); `VoicePrompt` (confirm/dictation mirror).
4. Wire card-31's `VoiceResult` through the store → HUD/prompt; set `phase` transitions; start a client-side timeout that flips to `error`.
5. Honour `enabled` in the PTT hook.

## Acceptance check
With `hub --mock` (script the mock STT for a sequence) + `bun run dev`:
- Holding PTT shows **listening**, release shows **transcribing**, then the read-back text appears — never a blank/frozen state.
- A scripted "focus ‹project›" returns a `select` directive → that Item's detail opens (selection changed) — proves `applyDirective`.
- A scripted "merge" returns `session.pendingConfirm` → the HUD shows "Say 'confirm merge'"; a scripted "confirm merge" clears it and shows the result.
- A scripted "comment" → dictation affordance; a body utterance → the captured text shows awaiting "post it".
- A `no_match` result renders calmly as a rejection, not an error blowup.
- Toggling voice off makes PTT inert and shows "Voice off".
- `applyDirective` unit tests cover select / move (clamped at ends) / show_needs_me / none.

## Out of scope / do NOT do
- No capture/transport logic (card 31). This card consumes the `VoiceResult`.
- Do not decide grammar/confirm/dictation outcomes on the client — only **render** `VoiceResult.session` and **apply** `directive` (ADR-0011, guardrail 11).
- Do not re-rank or mutate the world-model from voice — directives only touch client selection/view; actual state changes arrive via the normal SSE `state` stream.
- No spatial/headset UI (Phase 2).
