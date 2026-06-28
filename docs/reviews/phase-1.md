# Phase 1 Review

**Date:** 2026-06-28
**Reviewer:** Claude (Opus 4.8)
**Scope:** The full Phase 1 build (cards 22–34 — push-to-talk voice on the flat cockpit) against the plan, ADRs 0009–0013, the `CONTEXT.md` *Voice* glossary, and `docs/voice-grammar.md`.

## Verdict

**Faithful, high-quality build — the flat voice loop is complete and the safety model holds.** All five Phase 1 ADRs are honored in the code, not just the tests: the loop is Hub-brokered, the command grammar is closed and resolves against the selected Item's real Actions, every dangerous path is funneled through one server-side reducer, STT/TTS sit behind a pluggable HTTP contract with a working mock, and the client stays thin. The two findings below were minor and have been fixed. The one thing a static review can't cover is a real-model (Parakeet/Piper on the GPU box) round-trip — see Residual.

## Method

Static read of every load-bearing voice file — schema voice contract, the two pure cores (`grammar.ts`, `session.ts`), the gateway orchestrator, STT/TTS clients, the HTTP route, the `request_changes` adapter action, config + boot wiring, the `aspex voice check` CLI, the web capture/PTT/UX layer and its store/directive wiring, and the reference Python server — plus the objective gates (Bun + Python), and a trace of the safe-grammar invariants through the code path.

## Objective gates

| Check | Result |
|---|---|
| `bun test` | **190 pass / 0 fail** across 27 files (was 101/18 at Phase 0) |
| `bun run typecheck` | clean across all 9 Bun packages |
| `bun run lint` (Biome) | clean, 110 files |
| Python mock contract | `pytest` **4 passed** (`VOICE_BACKEND=mock`, no GPU) |
| Dependency discipline | Hub voice = Bun built-ins + `hono` only (no audio/native addons; Bun-compile-safe, ADR-0008). Parakeet/Piper/FastAPI live in `services/voice-server`, a separate Python service the Hub never imports |
| Local-first posture | Hub still binds `127.0.0.1`; STT/TTS reached **outbound**; default STT endpoint is `localhost`; no cloud STT/TTS; Web Speech not used |

## ADR adherence

| ADR | Decision | Status |
|---|---|---|
| 0009 | Phase 1 flat-voice only; WebXR mic-gate split out | ✅ No headset/WebXR code in Phase 1; gate documented as the hardware-blocked Phase 2 entry gate in `90-later-phases-outline.md` |
| 0010 | Hub-brokered voice gateway; STT/TTS are services, not Adapters | ✅ `VoiceGateway` orchestrates STT→grammar→session→dispatch→TTS; STT/TTS are **not** in `AdapterRegistry`; client only POSTs audio + context to localhost |
| 0011 | Closed grammar mapped to existing Actions; safe-grammar server-side | ✅ `parse()` matches a closed `VERBS`/phrase table; action verbs require the id to be present in the selected Item's `actions` (`action_unavailable` otherwise); referents come from client `VoiceContext`; no Hub-tracked selection |
| 0012 | Free-text dictation via two-step read-back-before-post; `request_changes` action | ✅ dictation mode captures the next utterance verbatim, reads it back, posts only on "post it"; `adapter-github` gains `request_changes` (REST `REQUEST_CHANGES` + body; empty body rejected without an API call) |
| 0013 | Generic HTTP STT/TTS contract + ordered fallback + reference server + mock | ✅ `HttpSttClient` tries `endpoints` in order, validates `{text,confidence∈[0,1]}`, throws only when all fail; `HttpTtsClient` never throws (degrades to text); `MockSttClient`/`MockTtsClient` + a reference FastAPI server with a `mock` backend |

## Grilled-scenario verification (in code, traced through the dispatch path)

The cardinal Phase 1 guarantee is **the safe-grammar funnel**: the only code that calls `dispatchAction` is the gateway's `dispatch` effect, and that effect is only ever produced by the pure `reduce()` for (a) a non-confirmable `action`, (b) a matching `confirm`, or (c) a `post` with a dictated body. Verified:

- **No-match never acts.** Low-confidence (checked first, in *every* mode including dictation), unknown command, missing/ambiguous referent, and action-not-on-this-Item all return a `no_match` → `noMatch` effect → no dispatch. STT failure is caught in the gateway → "I couldn't hear that." → no dispatch.
- **One utterance can't request *and* confirm.** A `requiresConfirmation` action (merge) → `armed`, `pendingConfirm` set, **no dispatch**; only a separate matching "confirm merge" dispatches, and `confirmed:true` is added **only** on the `confirm` path. Pending confirm expires on `confirmTtlMs` and is cleared by any recognized command, but a `no_match` leaves it intact.
- **Dictation read-back-before-post.** "comment"/"request changes" → prompt; the next whole utterance → verbatim body + read-back; only "post it" dispatches, with `payload.body`. "post it" with no body → `unknown_command`, dictation still armed.
- **request_changes** creates a `REQUEST_CHANGES` review with the dictated body; an empty body returns `{ok:false}` without touching Octokit.

These are backed by `grammar.test.ts`, `session.test.ts`, and the integration `gateway.test.ts` (merge-arms-then-confirm, cancel, full dictation post, low-confidence reject, STT-failure reject, what-needs-me directive, TTS present/absent/failure).

## Smoke / end-to-end (mock)

- **Hub voice loop end-to-end** is exercised headlessly by `gateway.test.ts` against `MockSttClient` (scripted transcripts) + a spy `dispatchAction` — the mock-first acceptance from card 34.
- **HTTP surface** (`voice-http.test.ts`): multipart `/voice/utterance` → `VoiceResult`, `audioUrl` round-trip through the TTL cache, 400 on bad context, 503 when voice is unconfigured.
- **Reference server** answers `/health`, `/transcribe`, `/speak` under the `mock` backend; the contract shapes match `HttpSttClient`/`HttpTtsClient`.
- `aspex voice check` probes each STT endpoint + TTS over the same contract and reports the fallback order.

## Findings & resolutions

1. **"open it" was acknowledged but did nothing** (functional gap vs `docs/voice-grammar.md`). The `open` effect returned a read-back of `"Opened <id>."` but **no client directive**, and `ClientDirective` had no `open` variant — so the web client was never told to open the PR, and the read-back was misleading. **Fixed:** added an `{ type: "open"; id }` directive (schema + `isDirective`), the gateway now emits it with an honest `"Opening <id>."` read-back, `applyDirective` opens the Item's `deepLink` (`window.open(..., "noopener,noreferrer")` via the store adapter), the grammar doc row is updated, and tests were added (`applyDirective.test.ts` open case + a gateway open-directive test). Exhaustiveness fix in `navigationReadback` to keep the switch total.
2. **`.gitignore` did not cover Python build artifacts.** `services/voice-server/__pycache__/` and `.pytest_cache/` were sitting untracked and would have been committed. **Fixed:** added `__pycache__/`, `.pytest_cache/`, `*.pyc`; removed the stray directories.

After fixes: `bun test` 190 pass / 0 fail, typecheck + lint clean, Python contract 4 passed.

## Residual / not covered by a static review

- **No real-model live smoke.** Parakeet (NeMo/CUDA) STT and Piper TTS were not run — that needs the GPU "Ollama box". The reference server's `real` backend path (NeMo, Piper binary, `ffmpeg` webm→PCM, the confidence proxy) is therefore unexercised; only the `mock` backend and the TS clients are verified. Run a one-off real round-trip when the GPU host is set up.
- **Tauri webview mic permission** (getUserMedia inside WebView2/WKWebView) is not verified in a packaged build — same residual as the Phase 0 Tauri release build, which still hasn't been run.
- **Mic stream is cached open** between presses (no continuous *recording* — `MediaRecorder` only runs while held — but the OS mic indicator stays lit). Within card-31 scope; could stop tracks when idle if the lit indicator is undesirable.
- **WebXR mic-capture Phase 2 entry gate** (ADR-0009) remains hardware-blocked by design; it is not part of Phase 1 and does not gate it.
- **The build is uncommitted** in the working tree (not per-card commits like Phase 0). Worth committing the reviewed state once the name/remote is settled.
