# Aspex — Phase 1 Build Plan (Task Card Index)

Phase 1 adds **push-to-talk voice to the flat cockpit**. It builds **on top of the committed Phase 0** (cards 01–21): same monorepo, same Hub, same web client, same `AttentionItem` world-model. Build the cards **in order**; later cards depend on earlier ones, and several extend existing Phase 0 files rather than create new packages.

Read this index fully before starting any card. It carries the rules and the canonical voice contract every card assumes. The Phase 0 index (`00-index.md`) and `../../CONTEXT.md` still apply in full.

---

## What Phase 1 delivers (Definition of Done)

> Holding a button (or the push-to-talk key) on the flat cockpit, I speak a fixed command — "what needs me", "focus AtlasCore", "read it", "approve", "merge" — and Aspex transcribes it locally (Parakeet on the GPU box), does the right thing through the **existing** action dispatch, and reads the result back to me (text on screen + Piper speech). Dangerous actions (`merge`) require a **separate spoken confirm-phrase**. I can **dictate** a comment or a request-changes verdict, hear it read back, and say "post it" to send. A command it doesn't understand — or can't hear confidently — is **rejected out loud**, never guessed into an action.

Phase 1 stays **flat and local-first**: no headset, no cloud STT/TTS, no telemetry. The whole loop runs against a **mock STT/TTS** with no GPU, so it builds and tests in CI.

**Explicitly NOT in Phase 1** (see ADR-0009): the WebXR `immersive-ar` mic-capture verification. That is the hardware-gated **Phase 2 entry gate** — see `90-later-phases-outline.md`.

---

## Locked decisions you must not relitigate

Phase 0's ADRs (0001–0008) still bind. Phase 1 adds:

- **ADR-0009** — Phase 1 is **flat voice only**; the WebXR mic-capture check is a separate hardware-gated **Phase 2 entry gate**, not a Phase 1 card.
- **ADR-0010** — The voice loop is **Hub-brokered** (the **voice gateway** subsystem). The client captures and plays audio; the Hub does STT → grammar → dispatch → TTS. STT/TTS are **services, not Adapters**.
- **ADR-0011** — The command grammar is a **closed vocabulary** mapped to the selected Item's **real Actions**. The safe-grammar rules (no-match never acts; confirm-phrase keyed off `requiresConfirmation`; referents from client voice-context) are enforced **server-side**.
- **ADR-0012** — **Free-text dictation is in Phase 1**, but only via a **two-step dictation mode** with **mandatory read-back-before-post**; dictated content elevates the confirm requirement. Adds a `request_changes` github action.
- **ADR-0013** — STT/TTS are reached over a **generic HTTP contract** (`/transcribe`, `/speak`) with an **ordered-endpoint fallback**, a **reference Python server**, and a **mock**. Web Speech is dev-only.

Use the glossary words exactly (`../../CONTEXT.md`): Voice gateway, Utterance, Push-to-talk, Voice context, Read-back, Client directive, Command grammar, Confirm-phrase, Dictation mode, Voice service.

---

## Baked-in tech stack (additions to Phase 0; do not substitute without an ADR)

| Concern | Choice | Notes |
|---|---|---|
| Mic capture | **`getUserMedia` + `MediaRecorder`** (browser) | `webm/opus` blob; runs in the Tauri webview and a plain DeX/desktop browser. No Rust audio. |
| Audio playback | **`HTMLAudioElement`** | plays the Piper read-back returned by the Hub. |
| STT | **Parakeet** (NeMo, GPU) via a reference Python **FastAPI** server | behind the `/transcribe` contract; CPU **whisper.cpp/faster-whisper** is just a second endpoint. |
| TTS | **Piper** (local neural) via the `/speak` contract | text always shown too; **Web Speech = dev-only, off by default**. |
| STT/TTS transport | **HTTP (generic contract)** | Hub → service URLs from config; `localhost` in dev, GPU box in prod. |
| Voice tests | **`bun test`** + **mock STT/TTS** | no GPU needed; reference Python server has its own minimal check. |

The Hub stays **Bun-compile-safe** (ADR-0008): all new Hub code is Bun/TS, no native addons. The Python server is a *separate* reference service, never imported by the Hub.

---

## Repository layout (additions)

```
aspex/
  apps/
    hub/
      src/voice/          # NEW: voice gateway subsystem
        sttClient.ts      #   /transcribe client (ordered endpoints, fallback, timeout)
        ttsClient.ts      #   /speak client (Piper)
        grammar.ts        #   pure parser: transcript + context + actions -> Intent
        session.ts        #   pure state machine: pending-confirm + dictation mode
        gateway.ts        #   orchestrator: STT -> grammar -> session -> dispatch -> TTS
      src/http/voice.ts   # NEW: POST /voice/utterance (+ audio fetch)
    web/
      src/voice/          # NEW: capture hook, PTT control, voice UX, directive applier
  packages/
    schema/src/voice.ts   # NEW: VoiceContext, Intent, ClientDirective, VoiceResult, ...
    adapter-github/        # EXTENDED: request_changes action
  services/
    voice-server/          # NEW: reference Parakeet STT + Piper TTS (Python/FastAPI) + mock
  docs/
    voice-grammar.md       # NEW: the canonical command grammar (written in card 34)
```

---

## The canonical voice contract (the shared types — `packages/schema/src/voice.ts`)

Built in **card 23**. Do not change these shapes without an ADR.

```ts
import type { ItemId, Action } from "./index";

// Attached by the client to every Utterance so the Hub can resolve referents (ADR-0011).
export interface VoiceContext {
  selectedId?: ItemId;        // the client's current selection (card 12)
  needsMeIds: ItemId[];       // ordered as shown — for "the top one" / "the second"
}

export interface Transcript {
  text: string;
  confidence: number;         // 0..1 from the STT service
}

// What the pure parser produces. (card 25)
export type Intent =
  | { kind: "nav"; directive: ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "action"; itemId: ItemId; actionId: string }    // approve / re-run / merge(arm)
  | { kind: "confirm"; itemId: ItemId; actionId: string }   // "confirm merge"
  | { kind: "dictate"; itemId: ItemId; actionId: string }   // arm dictation (comment / request_changes)
  | { kind: "dictation_body"; text: string }                // verbatim body, only in dictation mode
  | { kind: "post" }                                        // "post it"
  | { kind: "cancel" }                                      // "cancel" / "never mind"
  | { kind: "no_match"; heard: string; reason: NoMatchReason };

export type NoMatchReason =
  | "low_confidence" | "unknown_command" | "no_referent"
  | "action_unavailable" | "ambiguous";

export type ClientDirective =
  | { type: "select"; id: ItemId }
  | { type: "move"; delta: 1 | -1 }
  | { type: "show_needs_me" }
  | { type: "none" };

// Pure session state carried between Utterances (card 26).
export interface VoiceSession {
  pendingConfirm?: { itemId: ItemId; actionId: string; label: string; armedAt: string };
  dictating?: { itemId: ItemId; actionId: string };
}

// What POST /voice/utterance returns (card 28).
export interface VoiceResult {
  ok: boolean;                 // false for no-match / errors (readback still present)
  readback: string;            // ALWAYS present; shown on screen
  audioUrl?: string;           // Piper read-back (omitted if TTS off / failed)
  directive?: ClientDirective; // optional UI effect for the client to apply
  session: VoiceSession;       // the client mirrors this (shows "say 'confirm merge'", etc.)
}
```

---

## The canonical command grammar (closed vocabulary — ADR-0011)

The parser (card 25) matches **only** these. Anything else → `no_match` (read back, no action). Matching is case-insensitive over the normalized transcript; action verbs resolve against the **selected Item's `actions`** (the Hub knows them).

| Spoken (synonyms) | Intent | Confirm behaviour |
|---|---|---|
| "what needs me", "show what needs me" | `nav` show needs-me + read top-N | — |
| "focus ‹project›" | `nav` select that project's top Item | — |
| "next", "previous" | `nav` move ±1 in needs-me | — |
| "read it", "read this" | `read` selected Item (summary + pending actions) | — |
| "open it", "open this" | `open` selected Item's deep-link | — |
| "approve" | `action` approve on selected | per `Action.requiresConfirmation` |
| "re-run", "re-run checks" | `action` rerun on selected | none |
| "merge" | `action` **arm** merge on selected | **dangerous** → needs "confirm merge" |
| "confirm ‹verb›" (e.g. "confirm merge") | `confirm` the armed action | fires it |
| "comment" | `dictate` → comment | enters dictation mode |
| "request changes", "reject" | `dictate` → request_changes | enters dictation mode |
| "post it", "send it" | `post` the dictated body | fires the dictated action |
| "cancel", "never mind" | `cancel` pending confirm / dictation | — |

**Safe-grammar invariants (all server-side, all tested):**
1. **No-match never acts.** Below the confidence threshold, unknown command, missing/ambiguous referent, or action-not-on-this-Item → `no_match`, read back, **zero** side effects.
2. **One utterance can't request *and* confirm.** A `requiresConfirmation` action only arms; the **separate** confirm-phrase fires it. Pending confirm is bound to `(itemId, actionId)` and expires (timeout or any other command).
3. **Dictation is bounded.** Free text is accepted **only** while `dictating` is set; the body is read back and requires "post it" before sending. (ADR-0012)
4. **Confidence gate.** Transcripts below `voice.confidenceThreshold` are `low_confidence` no-matches (configurable).

---

## Global guardrails (in addition to Phase 0's eight)

9. **Audio is data, never code.** The Hub never executes, interprets, or shells out with transcript text except as a grammar lookup or a literal comment body. No `eval`, no string→command beyond the closed grammar.
10. **Local-first stays intact.** No cloud STT/TTS. Web Speech is dev-only and off by default. The default config points at the local/tailnet GPU box, never a hosted API.
11. **The Hub is the only place the safe-grammar rules live.** The client never decides whether an action is allowed or confirmed — it sends the utterance + voice-context and renders what comes back.
12. **Mock-first.** Every Hub voice card must pass with the mock STT/TTS and no GPU. The reference Python server is verified separately.
13. **Never silently wrong, out loud.** Staged feedback (listening → transcribing → acting → read-back), honest timeouts, and rejection read-backs are part of each relevant card — the voice form of ADR-0003.

---

## Card format

Same as Phase 0: **Goal · Depends on · Files · Interfaces/stubs · Steps · Acceptance check (runnable) · Out of scope**. One card per branch/PR.

---

## Phase 1 card list (build in this order)

**Contract**
- `23` — `packages/schema` voice types (VoiceContext, Intent, ClientDirective, VoiceResult, VoiceSession + validators)

**Voice gateway (Hub) — pure cores first**
- `24` — STT/TTS clients + mock (`/transcribe` ordered fallback, `/speak`, timeouts; injectable config)
- `25` — Command grammar parser (pure: transcript + context + actions → Intent; closed vocab; confidence gate; no-match)
- `26` — Voice session state machine (pure: arm/confirm/expire; enter/exit dictation; reduce Intent → effect + next session)
- `27` — Voice gateway orchestrator (STT → parser → session → dispatch → TTS → VoiceResult)
- `28` — Hub HTTP voice endpoint (`POST /voice/utterance` multipart audio + context; audio fetch; extends card 07)

**Adapter extension**
- `29` — `adapter-github` `request_changes` action (REST `REQUEST_CHANGES` + body; extends card 15)

**Reference services**
- `30` — Reference Parakeet STT + Piper TTS server (`services/voice-server`, Python/FastAPI) + mock parity

**Web client**
- `31` — Web audio capture + PTT control (getUserMedia/MediaRecorder hook, hold-button + hold-Space, mic permission, voice-context assembly, POST utterance, play read-back)
- `32` — Web voice UX (staged feedback, read-back display, client-directive applier, dictation-mode UI, error/timeout surfacing, voice on/off toggle)

**Config / ship**
- `33` — Voice config + CLI (`voice` config section, endpoints/threshold/timeouts/ptt-key, `aspex voice check`; extends card 09)
- `34` — Docs + grammar reference + threat-model update + CI + end-to-end mock acceptance (`docs/voice-grammar.md`, voice attack surface, full PTT→read-back smoke against mock)

**After Phase 1:** the WebXR mic-capture **Phase 2 entry gate** (ADR-0009) and Phases 2–4 remain outlined in `90-later-phases-outline.md`.
