# Card 34 — Docs, grammar reference, threat-model update, CI, end-to-end acceptance

## Goal
Document Phase 1 as shipped, write the canonical grammar reference, extend the threat model with the voice attack surface, update CI to run the voice tests, and prove the whole loop end-to-end against the mock. The Phase-1 counterpart of card 21.

## Depends on
- All Phase 1 cards (23–33). This documents the finished phase.

## Files to create / edit
```
docs/voice-grammar.md            # NEW: the canonical command grammar
docs/threat-model.md             # EDIT: add the voice attack surface
docs/event-schema.md             # EDIT: link the voice contract (VoiceResult/VoiceContext)
docs/licenses.md                 # EDIT: add Piper, Parakeet/NeMo, FastAPI (services), MediaRecorder (browser, no dep)
README.md                        # EDIT: voice quick-start + the GPU-box setup pointer
.github/workflows/ci.yml         # EDIT: ensure bun voice tests run; optional python contract test
```

## Content requirements

**`docs/voice-grammar.md`** — the single source of truth for the grammar (the index table, expanded): every spoken phrase + synonyms, the Intent it maps to, referent rules, the confirm-phrase rule, the dictation flow, and every `no_match` reason with its read-back string. Cards 25/32 must agree with this doc. State the safe-grammar invariants (ADR-0011) prominently.

**`docs/threat-model.md`** (add a "Voice (Phase 1)" section) — the stance as shipped:
- **Audio/transcripts are data, never code** (guardrail 9): the transcript is only ever a closed-grammar lookup or a literal comment body; no `eval`, no shelling out with transcript text.
- **The safe-grammar rules live server-side** (ADR-0010/0011): the client cannot trigger or confirm an action by itself; no-match never acts; `dangerous` actions need a separate confirm-phrase; dictated free-text needs read-back-before-post (ADR-0012).
- **Local-first** (guardrail 10): STT/TTS are local/tailnet services; no cloud STT/TTS; Web Speech is dev-only. The Hub stays `127.0.0.1`; it reaches the GPU box outbound over the tailnet.
- **Mic posture:** push-to-talk only — no open mic, no wake word; capture is per-press.

**`docs/event-schema.md`** — add the voice contract types as the reference for the `/voice/utterance` request/response.

**`README.md`** — a voice quick-start: enable `voice` in config, run the reference server (link `services/voice-server/README.md`), `aspex voice check`, then push-to-talk. Keep the "personal project, best-effort support" tone. Note voice is opt-in and needs the GPU box (or `voice.mock`).

**`.github/workflows/ci.yml`** — confirm `bun test` covers the new packages/apps; optionally add a job running `services/voice-server` `pytest` in `VOICE_BACKEND=mock` (no GPU).

## Acceptance check (end-to-end, mock)
```bash
# whole loop, no GPU:
ASPEX_VOICE_ENABLED=1 bun run apps/hub/src/cli.ts hub --mock &
# mock STT scripted to: "what needs me" -> "focus <project>" -> "merge" -> "confirm merge"
cd apps/web && bun run dev
# Manual (or Playwright): PTT each step; verify read-backs, the focus directive selects the Item,
# "merge" arms (no dispatch), "confirm merge" dispatches once.
bun install && bun run typecheck && bun test && bun run lint   # all green
```
- `bun test` green across schema (23), hub voice (24–28), adapter-github (29), web (31–32), config (33).
- `docs/voice-grammar.md` matches the parser (card 25) — spot-check every row.
- CI green on a fresh clone.
- Phase-0 acceptance checks still pass (no regression).

## Out of scope / do NOT do
- Do not document spatial/headset voice or the WebXR mic-gate as done — they are Phase 2 (`90-later-phases-outline.md`). Document the **flat** voice loop only.
- Do not claim cloud or free-form NL voice — Phase 1 is local + fixed-grammar (+ bounded dictation).
- Do not add telemetry (standing Phase 0 promise).
- Do not pull AGPL/GPL deps; keep `docs/licenses.md` honest (Piper/Parakeet/Piper licences noted; they're separate services, not linked into the core).
