# Aspex — Phase 3 Build Plan (Task Card Index)

Phase 3 adds **delegation depth**: a **free-form intent** path (a local LLM that turns natural language into a *constrained* action, as a fallback behind the Phase 1 closed grammar) plus **three new agent Sources** — **codex**, **opencode**, **cursor** — wired as observe-only Adapters. It builds **on top of committed Phase 0 + Phase 1 + Phase 2** (cards 01–45): same monorepo, same Hub, same web client, same `AttentionItem` world-model — which it **does not modify**. Build the cards **in order**; later cards depend on earlier ones, and several **extend** existing Phase 1 files (the voice gateway, the schema, the CLI) rather than create new subsystems.

Read this index fully before starting any card. It carries the rules and the canonical contracts every card assumes. The Phase 0 index (`00-index.md`), the Phase 1 index (`22-phase-1-index.md`), the Phase 2 index (`35-phase-2-preview-deck-index.md`), and `../../CONTEXT.md` still apply in full.

> **Scope:** this is the **buildable-now delegation core**. **Teach Pane** (Labs), **PTY control for claude-code** (billing-gated — re-verify §8 first), and the **cowork** Provision (integration path research-TBD) stay outlines in `90-later-phases-outline.md`. Nothing here needs a headset, and free-form intent runs **local + free** on the existing GPU box (Ollama) or against a mock with **no GPU at all**.

---

## What Phase 3 delivers (Definition of Done)

> I speak or **type** a natural-language command the fixed grammar doesn't cover — "approve the atlas PR", "merge the one that's passing", "show me what codex finished" — and Aspex, *only when the closed grammar can't match it*, asks a **local LLM** (Ollama on the GPU box) to map it to **one** structured action over my **live** needs-me list. The model can only ever pick a **real item** and a **valid action** on it (it can't invent ids or commands); a dangerous action still needs my separate **"confirm ‹verb›"**, and any free-form-originated action asks for an extra yes. Meanwhile my **codex** and **opencode** sessions show up in needs-me the moment they block or error — before any PR exists — and my **cursor** background agents do too (if I opt in and expose the webhook). Every new adapter is **observe + deep-link only**; none can drive an agent. With the LLM off, voice off, and the new adapters off, Phase 0–2 behave **exactly** as before.

Phase 3 stays **local-first**: no cloud LLM, no telemetry. The whole free-form loop runs against a **mock intent service** with no GPU, and every adapter runs against **recorded fixtures**, so it all builds and tests in CI.

**Explicitly NOT in Phase 3** (see ADRs): the **Teach Pane** (Labs); **PTY / two-way agent control** (deferred to a future ADR — ADR-0021); the **cowork** Provision (research-TBD); **compound / conditional / scheduled** intents (ADR-0020 — Aspex is not an orchestrator); a **public-webhook / Tailscale Funnel subsystem** (cursor is an opt-in, user-exposed lane only — ADR-0022).

---

## Locked decisions you must not relitigate

Phase 0's ADRs (0001–0008), Phase 1's (0009–0013), and Phase 2's (0014–0017) still bind. Phase 3 adds:

- **ADR-0018** — Free-form intent is a **fallback behind the closed grammar**: the grammar runs first; **only an `unknown_command` no-match** falls through to the LLM; the LLM's `Intent` re-enters the **same** funnel. Serves both voice and a typed **Intent bar**. Opt-in.
- **ADR-0019** — The local LLM is a **constrained "intent service"** — Ollama via **per-request JSON-Schema** (GBNF-enforced) structured outputs, generic HTTP, config URL, **pluggable**, **mock-first**, **not an Adapter**.
- **ADR-0020** — Free-form intent is **bounded by construction**: enum-constrained output, **single-shot** (never compound/conditional/orchestrating), the LLM can't emit `confirm`/`dictation_body`, and **free-form-originated actions elevate confirmation**. The LLM sees untrusted Item text but cannot escape the enum.
- **ADR-0021** — The new agent adapters (codex/opencode/cursor) are **observe + deep-link only**, own **agent-local** attention (PR-lifecycle stays the github adapter's), ingest **local-first**, and are **mock-first**.
- **ADR-0022** — Cursor's inbound webhook is an **opt-in, bounded exception** to poll-first/no-public-ingress: default off, signature-verified, **never auto-exposed**.

Use the glossary words exactly (`../../CONTEXT.md`): Free-form intent, Intent service, Intent bar; and the updated Source / Provision / Hook-relay entries.

---

## Baked-in tech stack (additions to Phase 0/1/2; do not substitute without an ADR)

| Concern | Choice | Notes |
|---|---|---|
| Local LLM | **Ollama** via `/api/chat` with `format` = JSON Schema | constrained decoding (GBNF inside Ollama); reached over HTTP like the voice services. Pluggable `IntentService`. |
| Constraint | **per-request JSON Schema** built from voice-context | enum of live `itemId`s + the selected Item's `actionId`s + an `abstain` production. The safety core (card 49). |
| Intent tests | **`bun test`** + **mock intent service** | no GPU / no Ollama needed; the real model is verified separately on the GPU box. |
| codex ingest | **`notify` → `aspex hook-relay`** | reuses the claude-code relay pattern (localhost POST). |
| opencode ingest | **`opencode serve` `/event` SSE** | local event stream → Signals; stream liveness → heartbeats. |
| cursor ingest | **opt-in inbound `statusChange` webhook** | reuses the generic webhook adapter plumbing; signature-verified; default off (ADR-0022). |
| Typed surface | **Intent bar** (web) | injects typed text as a transcript into the same pipeline; works with voice off. |

The Hub stays **Bun-compile-safe** (ADR-0008): all new Hub code is Bun/TS, HTTP only, **no native model bindings**. **No AGPL/GPL** added — verify and record Ollama, the opencode SDK, codex, and cursor client licences in `docs/licenses.md` (all expected MIT/Apache/BSD). **No new runtime npm deps** beyond a typed HTTP client if needed — `fetch` + SSE already exist.

---

## Repository layout (additions)

```
aspex/
  apps/
    hub/
      src/voice/
        intentService.ts    # NEW: IntentService client (Ollama /api/chat + format) + mock + ordered fallback
        intentSchema.ts      # NEW: pure builder — voice-context -> constrained-Intent JSON Schema (card 49)
        gateway.ts           # EXTENDED: unknown_command -> intent service -> constrained Intent -> elevate-confirm (card 50)
      src/http/intent.ts     # NEW: POST /intent (typed text + voice-context) -> IntentResult (card 51)
    web/
      src/intent/            # NEW: the Intent bar (typed NL input, reuses voice staged-feedback/confirm UX)
  packages/
    schema/src/intent.ts     # NEW: IntentRequest, IntentResult, IntentSource, FreeformConfig + validators (card 47)
    adapter-codex/           # NEW: notify/hook-relay-fed, observe-only (card 54)
    adapter-opencode/        # NEW: opencode serve /event SSE, observe-only (card 55)
    adapter-cursor/          # NEW: opt-in statusChange webhook, observe-only (card 56)
  docs/
    free-form-intent.md      # NEW: the pipeline, the constraint mechanism, the bounded-by-construction model (card 58)
```

---

## The canonical contracts

### 1. Free-form intent contract (`packages/schema/src/intent.ts`, card 47)

Built in **card 47**. **Does not modify** the existing `Intent` union or `types.ts` — it wraps them.

```ts
import type { ItemId, Intent, VoiceContext } from "./index";

// Where a parsed Intent came from (the gateway tags it; drives elevate-confirm).
export type IntentSource = "grammar" | "freeform";

// A compact, enum-ready view of one candidate item the model may reference.
export interface IntentCandidate {
  itemId: ItemId;
  summary: string;          // agent-authored, UNTRUSTED (ADR-0020)
  actions: string[];        // actionIds valid on this item
}

// What the gateway sends the intent service (card 48/50).
export interface IntentRequest {
  text: string;             // the utterance / typed line the closed grammar didn't match
  context: VoiceContext;    // selectedId + needsMeIds — the enum source
  candidates: IntentCandidate[];
}

// What the intent service returns: an Intent already constrained to the live space.
export interface IntentResult {
  intent: Intent;           // a FIRST-STAGE intent, or { kind:"no_match", reason:"unknown_command" }
  source: "freeform";       // honest provenance for readback + logging
}

export interface FreeformConfig {
  enabled: boolean;         // default false (ADR-0018)
  endpoints: string[];      // ordered Ollama base URLs (fallback like sttClient)
  model: string;            // e.g. "llama3.1"
  timeoutMs: number;
  elevateConfirm: boolean;  // default true (ADR-0020)
}
```

### 2. The intent-service seam (`apps/hub/src/voice/intentService.ts`, card 48)

```ts
export interface IntentService {
  // Returns a constrained Intent for an unmatched utterance, or a no_match. NEVER throws into the gateway.
  resolve(req: IntentRequest): Promise<IntentResult>;
}
// Implementations: OllamaIntentService (HTTP, schema from card 49) and MockIntentService (canned, for CI).
```

### 3. New HTTP surface (extends card 28's voice endpoint)

| Method + path | Purpose |
|---|---|
| `POST /intent` `{ text, context }` | typed **Intent bar** entry: run the **same** closed-grammar→fallback pipeline on `text`; returns a `VoiceResult` (readback + directive + session) |

(The voice path keeps `POST /voice/utterance`; both now share the extracted pipeline — card 51.)

### 4. New Source mappings (the adapters, cards 54–56)

| Source | Ingestion | Owns | v1 control |
|---|---|---|---|
| `codex` | `notify` → `aspex hook-relay` → `POST /signals/codex` | current `agent-turn-complete` payloads map to `done`/Ambient + heartbeat | **deep-link only** |
| `opencode` | subscribe `opencode serve` `/event` SSE | agent-local session state | **deep-link only** |
| `cursor` | opt-in inbound `statusChange` webhook (signed) | agent-local `error`/`finished` | **deep-link only** |

PR-lifecycle attention for all three stays the **github** adapter's (ADR-0002/0021).

---

## The free-form safety model (every relevant card upholds this)

1. **Grammar first, LLM last.** The closed grammar (card 25) parses every utterance. The intent service is called **only** when it returns `no_match` with reason **`unknown_command`**. `low_confidence` / `no_referent` / `action_unavailable` / `ambiguous` stay **hard** no-matches — no LLM. (ADR-0018)
2. **Constrained by construction.** The model is given a **JSON Schema** (card 49) whose `itemId` is an **enum of live ids** and whose `actionId` is an **enum of the selected Item's actions**, plus an `abstain` → `unknown_command` branch. It **cannot** emit an unknown id, free text, a fabricated action, or anything outside the `Intent` union. (ADR-0019/0020)
3. **First-stage only.** The schema permits `action` (arm) / `nav` / `read` / `open` / `dictate` / `no_match` — **never** `confirm`, `dictation_body`, or `post`. The deterministic two-step (spoken/typed "confirm ‹verb›", dictation "post it") is unchanged. (ADR-0020)
4. **Single-shot.** Exactly **one** Intent per utterance. No compound / conditional / scheduled actions — Aspex is **not** an orchestrator. (ADR-0020)
5. **Elevated confirm.** Any action whose Intent came from the intent service is treated as `requiresConfirmation` even if its normal tier is `safe`/`medium`. (ADR-0020)
6. **Honest provenance.** The read-back says when an interpretation was the LLM's ("I read that as: approve atlas#42 — say 'confirm' to proceed"), never silently.

---

## Global guardrails (in addition to Phase 0's 8, Phase 1's 9–13, Phase 2's 14–18)

19. **Grammar first; the LLM is a fallback only on `unknown_command`.** Other no-match reasons never reach the model. (ADR-0018)
20. **The LLM's output is a constrained `Intent`, never executable text.** Enum of live ids/actions + abstain; no string→command beyond the constrained union. The Phase-3 form of guardrail 9. (ADR-0019/0020)
21. **Free-form is single-shot and never orchestrates.** One Intent per utterance; no compound/conditional/scheduled; the model can't emit `confirm`/`dictation_body`/`post`; free-form-originated actions elevate confirm. (ADR-0020)
22. **New agent adapters are observe + deep-link only.** No `runAction` control; PR-lifecycle stays github's; agent-local attention only. (ADR-0021)
23. **Cursor inbound is opt-in and never auto-exposed.** Signature-verified; default off; Aspex opens no public ingress on its own. (ADR-0022)
24. **Mock-first everywhere.** The intent service and every adapter pass CI with **no GPU, no Ollama, no real agent tools** installed.

---

## Card format

Same as Phases 0/1/2: **Goal · Depends on · Files · Interfaces/stubs · Steps · Acceptance check (runnable) · Out of scope**. One card per branch/PR.

---

## Phase 3 card list (build in this order)

**Track A — Free-form intent (Ollama + GBNF)**
- `47` — `packages/schema` intent types (`IntentRequest`, `IntentResult`, `IntentSource`, `FreeformConfig` + validators; **does not touch the `Intent` union / `types.ts`**)
- `48` — **Intent service** client + **mock** (`OllamaIntentService` over `/api/chat` with `format`; ordered-endpoint fallback + timeout; `MockIntentService` canned; never throws into the gateway)
- `49` — **Constrained-Intent JSON-Schema builder** (pure: voice-context + selected actions → JSON Schema; enum of live ids/actions; `abstain`; first-stage-only) — *the safety core*
- `50` — **Free-form fallback in the gateway** (extend card 27: `unknown_command` → build schema → `intentService.resolve` → tag `freeform` → elevate confirm → re-enter `reduce()`; single-shot guard; honest read-back)
- `51` — **Reusable pipeline + text entrypoint** (extract the closed-grammar→fallback pipeline; add `gateway.handleText(text, ctx)`; Hub `POST /intent`; extends card 28)
- `52` — **Web Intent bar** (typed NL input on the cockpit → `POST /intent`; reuses the voice staged-feedback / read-back / confirm UX; works with voice off; extends card 32)
- `53` — **Intent config + CLI** (`intent`/`freeform` config section: enabled, endpoints, model, timeout, `elevateConfirm`; `aspex intent check` against mock/real; extends cards 09/33)

**Track B — Agent adapters (observe-only)**
- `54` — `adapter-codex` (codex `notify` → `aspex hook-relay` → Signal; agent-local State/Reason; deep-link; `--rm`-style honest coarseness note; fixtures + mock)
- `55` — `adapter-opencode` (subscribe `opencode serve` `/event` SSE → Signals; event→State map; stream liveness → heartbeats; deep-link; fixtures + mock)
- `56` — `adapter-cursor` (opt-in inbound `statusChange` webhook → Signal; signature verify; reuse webhook plumbing; default off; deep-link; ingress-caveat doc; fixtures + mock)
- `57` — **Wire the new adapters + ownership** (register codex/opencode/cursor in the `AdapterRegistry`; extend the source→adapter map; enforce the ADR-0002 partition vs github; per-adapter enable config)

**Ship**
- `58` — **Docs + threat-model + licences + CI** (`docs/free-form-intent.md`; threat-model: free-form prompt-injection + cursor cloud-ingress sections; `docs/licenses.md` updates; adapter-authoring updates; **end-to-end mock acceptance**: typed NL → constrained Intent → arm → confirm → dispatch, plus each adapter's fixture replay)

**After Phase 3:** the **Teach Pane** (Labs, reuses the intent-service seam), **PTY / two-way agent control**, the **cowork** Provision, the **Spatial Shell** track + **Phase 2 entry gate** (ADR-0009), and a **public-webhook / Funnel** subsystem remain outlined in `90-later-phases-outline.md`.
