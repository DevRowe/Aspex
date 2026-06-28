# Card 58 — Docs, threat-model, licences, CI, end-to-end acceptance

## Goal
Document Phase 3 as shipped: the free-form-intent reference, two new threat-model sections (free-form prompt-injection + cursor cloud-ingress), the new Source mappings, licence updates, adapter-authoring updates, CI, and an **end-to-end mock acceptance** of both tracks. The Phase-3 counterpart of cards 34/45.

## Depends on
- All Phase 3 cards (47–57). This documents the finished phase.

## Files to create / edit
```
docs/free-form-intent.md       # NEW: the pipeline, the constraint mechanism, the bounded-by-construction model
docs/threat-model.md           # EDIT: + "Free-form intent (Phase 3)" and "Cursor cloud webhook (Phase 3)"
docs/event-schema.md           # EDIT: + the intent contract + the codex/opencode/cursor Source mappings
docs/adapter-authoring.md      # EDIT: the three new ingestion patterns (notify-relay, serve-SSE, signed-webhook)
docs/licenses.md               # EDIT: Ollama, opencode + SDK, codex CLI, cursor (consumed via webhook only)
README.md                      # EDIT: free-form intent quick-start + the new adapters
.github/workflows/ci.yml       # EDIT: ensure the new packages/apps run under bun test
90-later-phases-outline.md     # EDIT: mark Track A/B chunked; keep Teach Pane / PTY / cowork outlined
```

## Content requirements

**`docs/free-form-intent.md`** — the single source of truth: the pipeline (closed grammar first → only `unknown_command` → [[Intent service]]), the **constraint mechanism** (per-request JSON Schema → GBNF inside Ollama, card 49), the **bounded-by-construction** safety model (enum output; single-shot; the model can't emit `confirm`/`dictation_body`/`post`; **elevate-confirm** for free-form-originated actions), the [[Intent bar]], config + `aspex intent check`, and an Ollama setup pointer. Cards 49/50 must agree with this doc.

**`docs/threat-model.md`** — add two sections, the stance as shipped:
- **"Free-form intent (Phase 3)"** — the LLM is fed **untrusted, agent-authored** Item text (summaries/titles) for referent resolution, so it is a prompt-injection surface; the defence is **structural** (ADR-0019/0020): output is an **enum-constrained `Intent`**, so injection can at worst pick a *real* item or a *valid* action — never invent ids/commands, never escape the union; dangerous actions still need a separate confirm-phrase; free-form-originated actions elevate confirm; single-shot (never orchestrating); Ollama is **local** (no cloud LLM). The Phase-3 form of guardrail 9.
- **"Cursor cloud webhook (Phase 3)"** — opt-in, **default off**, **signature-verified** (fail-closed without a secret), and **never auto-exposed**: the Hub binds `127.0.0.1`; reaching it from Cursor's cloud is the user's deliberate ingress choice (Tailscale Funnel). The one cloud-origin inbound surface, bounded per ADR-0022.

**`docs/event-schema.md`** — add the intent contract (`IntentRequest`/`IntentResult`) and the codex/opencode/cursor → Item mappings as reference.

**`docs/licenses.md`** — Ollama (MIT) + the model weights you choose (note the model's own licence), opencode (MIT) + its SDK, codex CLI (Apache-2.0); cursor is **consumed via its webhook payload + deep-link only — no cursor code is linked**, so no licence obligation (note it). Confirm **no AGPL/GPL** entered the core.

**`README.md`** — a free-form-intent quick-start: enable `intent` in config (or `ASPEX_INTENT_MOCK=1`), `aspex intent check`, type into the Intent bar; plus enabling codex/opencode/cursor. Keep the "personal project, best-effort support" tone; note all of it is opt-in.

**`.github/workflows/ci.yml`** — confirm `bun test` covers the new packages (`adapter-codex/opencode/cursor`) and hub/web apps; everything passes with **no GPU, no Ollama, no real agent tools** (mock-first).

## Acceptance check (end-to-end, mock)
```bash
# free-form intent, no GPU:
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun run apps/hub/src/cli.ts hub --mock &
# (mock intent service scripted: "approve the atlas review" -> {action,approve}; then "confirm approve")
curl -s -X POST 127.0.0.1:4317/intent -H 'content-type: application/json' \
  -d '{"text":"approve the atlas review","context":{"selectedId":null,"needsMeIds":["github:pr:o/atlas#42"]}}'   # armed (elevated)
curl -s -X POST 127.0.0.1:4317/intent -H 'content-type: application/json' \
  -d '{"text":"confirm approve","context":{"needsMeIds":["github:pr:o/atlas#42"]}}'                              # dispatched once
# adapters: replay codex/opencode/cursor fixtures -> Items with agent-local reasons (no PR-lifecycle)
bun install && bun run typecheck && bun test && bun run lint   # all green
```
- `bun test` green across schema (47), hub intent (48–51,53), web (52), adapters (54–57).
- `docs/free-form-intent.md` matches the schema builder (49) + the gateway fallback (50) — spot-check the safety bullets.
- CI green on a fresh clone, **no GPU / no Ollama / no agent tools**.
- Phase 0/1/2 acceptance checks still pass (no regression); with `intent`, voice, and the new adapters all off, behaviour is identical to Phase 2.

## Out of scope / do NOT do
- Do not document **Teach Pane / PTY / cowork** as done — they stay outlines in `90-later-phases-outline.md`.
- Do not claim a **cloud LLM** or a **public-webhook/Funnel subsystem** — Ollama is local; cursor ingress is user-exposed only.
- No telemetry (standing promise). No AGPL/GPL deps — keep `docs/licenses.md` honest.
- Do not document compound/conditional/scheduled intents — free-form is single-shot (ADR-0020).
