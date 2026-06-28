# Card 52 — Web Intent bar (typed natural-language input)

## Goal
A typed natural-language input on the flat cockpit — the [[Intent bar]] — that POSTs to `/intent` and renders the **same** staged-feedback / read-back / confirm UX as voice, **reusing card 32's result applier**. Usable with voice off (ADR-0018). The client never decides whether an action is allowed or confirmed — it sends `{ text, context }` and renders what comes back (guardrail 11).

## Depends on
- Card 51 (`POST /intent`), Card 32 (voice UX: read-back display, client-directive applier, confirm/session mirror), Card 12 (needs-me list + selection state), Card 31 (how voice-context is assembled).

## Files to create / edit
```
apps/web/src/intent/IntentBar.tsx        # the input + submit + result rendering
apps/web/src/intent/useIntent.ts          # POST /intent; returns VoiceResult; applies directive + mirrors session
# edit apps/web/src/Inbox.tsx (or the cockpit shell) # mount <IntentBar/> when intent is enabled
```

## Behaviour
- A visible text input (submit on Enter). Optional focus hotkey (e.g. `/`), distinct from the push-to-talk hold-key.
- On submit: assemble `VoiceContext` (`selectedId` + the `needsMeIds` **as shown**, exactly like card 31's voice-context), `POST /intent { text, context }`.
- Render the returned `VoiceResult`: the **read-back** line; apply the **directive** via card 32's applier (`select` / `move` / `show_needs_me` / `open`); **mirror `session`** so the UI shows "type or say 'confirm approve'" when an action is armed, or the dictation prompt.
- A follow-up line ("confirm approve", "post it", "cancel") is just another `POST /intent` — the server's session carries the pending-confirm/dictation (the gateway is stateful per card 26/50).
- **Honest provenance:** when the read-back indicates an LLM interpretation, show it plainly (the server already phrases it — card 50); do not hide that it was inferred.
- Visibility gated on `intent.enabled` (from a tiny `GET /intent/config` or reuse the `GET /voice/config` shape — add `{ intentEnabled }`).

## Steps
1. `useIntent`: POST helper + the same directive/session handling card 32 uses for voice (extract/share that applier rather than fork it).
2. `IntentBar`: controlled input, submit, render read-back + armed/dictation state.
3. Mount in the cockpit when intent is enabled; keep it independent of the voice toggle.
4. Component tests with a stubbed `fetch` (mock `VoiceResult`s).

## Acceptance check
```bash
cd apps/web && bun test       # green
# manual / Playwright:
#  - type "what needs me"            -> needs-me read-back, list shown
#  - type "approve the atlas review" -> armed + "confirm approve" prompt (LLM interpretation shown)
#  - type "confirm approve"          -> dispatched once
#  - with voice disabled, the bar still works end-to-end
```
Tests/asserts: a mock needs-me result selects/shows; an armed result shows the confirm prompt + applies no action; a dispatch result shows the done read-back; the bar renders and submits with voice off.

## Out of scope / do NOT do
- No audio / mic — that is the voice path (cards 31/32). The Intent bar is text-only.
- Do **not** re-implement the safe-grammar/confirm logic client-side — the server decides (guardrail 11/21); the client only renders + re-posts follow-ups.
- No new result semantics — reuse card 32's applier and the `VoiceResult` shape; do not invent a parallel response type.
- Do not show the bar when `intent.enabled` is false.
