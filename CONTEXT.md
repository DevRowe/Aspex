# Aspex

Local-first mission control for coding agents: a presentation + interaction layer that aggregates the live state of many agents across many projects into one attention-ranked view, tells you what needs you and why, and lets you respond safely. It is **not** an orchestrator — it consumes upstream tools (Claude Code, Codex, GitHub, containers), it never runs agents itself.

## Language

### Core attention model

**Item** (Attention Item):
The canonical unit of the world-model — a persistent thing that may need your attention, keyed by a stable source-derived id (e.g. `github:pr:owner/repo#42`). There is exactly **one Item per real-world object** (one PR, one session, one issue), never one per condition. It has a current `state`, a single ranking `Reason`, and an `actions` array that may hold several actions; it is upserted in place as new information arrives, never a point-in-time record.
_Avoid_: AttentionEvent, event, status, card (a card is the UI rendering of an Item, not the Item itself).

**Reason**:
The single highest-priority condition that places an Item on a rung of the priority ladder and explains *why* it needs you (e.g. `blocked_on_human`, `failing_ci`, `review_requested`). An Item has exactly one Reason at a time even when several conditions are true at once; the others surface as additional `actions` or `evidence`, not as extra cards.
_Avoid_: rule, trigger, cause.

**Signal**:
A raw inbound observation — a poll result or a hook POST — that creates or updates exactly one Item. Signals are transient and may be discarded after they have been applied.
_Avoid_: event, message, notification.

**World-model**:
The Hub's complete set of current Items across every source. The single source of truth the client renders.
_Avoid_: state store, cache, feed.

**State**:
What the source last reported an Item is doing: `working | blocked | needs_review | done | error`.
_Avoid_: status.

**Liveness**:
How much we currently trust an Item's reported state, based on freshness: `live | quiet | stale | lost`. Orthogonal to State — an Item can be "working · stale" (we think it's working but haven't heard recently). Computed two ways (see ADR-0003): for polled sources it reflects the Hub's poll health; for push sources it reflects heartbeat freshness. Terminal states never decay.
_Avoid_: freshness, health, staleness.

**Heartbeat**:
A low-cost periodic "still here" signal from an adapter that keeps a push-source Item `live`. For claude-code it is synthesized from a high-frequency hook (`PostToolUse`); for polled sources the equivalent is a successful poll cycle. Distinct from a Signal — a Heartbeat refreshes liveness without changing State.
_Avoid_: ping, keepalive, pulse.

**Needs-me**:
The ranked, capped list of Items where `attentionRequired` is true, ordered by the priority ladder. The product's primary answer to "what needs me?".
_Avoid_: inbox (informal only), queue, todo.

**Ambient**:
Items that are present in the world-model but do not require action — working sessions, informational updates, and completed sessions whose attention has moved elsewhere (e.g. to a PR). Ambient Items are visible on demand but never appear in needs-me.
_Avoid_: background, idle, noise.

**Action**:
A risk-tiered control operation Aspex can perform on an Item through its adapter — `safe | medium | dangerous`, where dangerous requires a confirm-phrase. Two-way actions exist only where a safe official mechanism does (e.g. github REST: approve/merge/comment/re-run). Where none exists (a blocked claude-code session in Phase 0), the only affordance is a Deep-link, not an Action.
_Avoid_: command, operation, control.

**Deep-link**:
A "jump to where this lives" affordance (open the PR, focus the terminal/session) offered when Aspex can show an Item but not safely act on it. The read-only counterpart to an Action.
_Avoid_: shortcut, link.

**Attention ownership**:
The rule that decides which adapter may set `attentionRequired` for a given lifecycle stage, so one unit of work never glows twice. Per-agent adapters (claude-code, codex) own in-flight attention (`blocked`, `error`); the github adapter owns PR-lifecycle attention (review, CI, merge). See ADR-0002.
_Avoid_: routing, precedence.

### Adapters & ingestion

**Source**:
The system an Item originates from, named on the Item: `github | claude-code | codex | webhook | ntfy | mcp`. A label on data, distinct from the Adapter that talks to it.
_Avoid_: provider, integration, connector.

**Adapter**:
A pluggable module that ingests Signals from one Source into the world-model and dispatches Actions back out to it. Implements a single interface (`start`/`listActions`/`runAction`/`stop`) so new Sources slot in without touching the engine.
_Avoid_: plugin, driver, connector.

**Provision**:
An Adapter whose interface is stubbed now but wired later — cursor, opencode, cowork. A planned, not-yet-live Adapter.
_Avoid_: stub, placeholder, future adapter.

**Hook-relay**:
The small bundled command (`aspex hook-relay`) that Claude Code's hooks invoke; it reads Claude Code's stdin JSON and POSTs it to the Hub as a Signal. Installed into user-level `settings.json` by `aspex hooks install`. Cross-platform stand-in for raw curl.
_Avoid_: webhook, shim, forwarder.

### Voice (Phase 1)

**Voice gateway**:
The Hub subsystem that brokers the whole push-to-talk loop: it receives an Utterance from the client, calls the STT service to transcribe it, parses the transcript against the Command grammar, dispatches the resulting Action, and returns a Read-back. Not an Adapter — it consumes the STT/TTS services and drives the existing action dispatch. See ADR-0010.
_Avoid_: voice adapter, speech adapter, voice pipeline (informal only).

**Utterance**:
One discrete audio capture produced by a single push-to-talk press-and-release — the unit the client sends to the Hub for transcription. Batch-transcribed whole (not streamed). Distinct from a Signal: an Utterance carries a spoken command, never a world-model observation.
_Avoid_: recording, clip, audio event.

**Push-to-talk** (PTT):
The interaction where you hold a control (an on-screen button, or the configurable hold-key) to capture one Utterance and release to send it — no open mic, no wake word. On flat the trigger is the button/key; on a headset (Phase 2) it becomes gaze-dwell + hold.
_Avoid_: hold-to-talk, hotword, wake word.

**Voice context**:
The small snapshot the client attaches to an Utterance so the Hub can resolve deictic and ordinal references — the current `selectedId` plus the ordered needs-me ids as shown. It is how the Hub knows what "this", "selected", or "the top one" mean while selection itself stays client-side.
_Avoid_: focus state, cursor, session context.

**Read-back**:
The Hub's spoken-and-written confirmation returned after handling an Utterance — a concise text line plus TTS audio (Piper) describing what happened or what it heard. The voice counterpart of an on-screen toast.
_Avoid_: response, reply, TTS output.

**Client directive**:
An optional UI instruction the Hub returns alongside a Read-back when a command changes client state — e.g. "select Item X", "next". The client applies it; the Hub never mutates client selection directly.
_Avoid_: command, event, push.

**Command grammar**:
The fixed, closed vocabulary of spoken commands Phase 1 understands — navigation/query verbs plus action verbs that resolve against the selected Item's real Actions. Closed by design: anything outside it is a no-match and never triggers an Action (free-form intent is Phase 3). The canonical list lives in `docs/voice-grammar.md`. See ADR-0011.
_Avoid_: intent model, NLU, command set.

**Confirm-phrase**:
The separate, explicit follow-up utterance ("confirm merge") required to fire an armed `requiresConfirmation` Action. The first utterance only arms; the Confirm-phrase fires. The spoken counterpart of card 13's typed ConfirmGate; one utterance can never both request and confirm.
_Avoid_: confirmation, verification, second factor.

**Dictation mode**:
The bounded state, entered by a dictation verb (`comment`, `request changes`), in which the next whole Utterance is captured verbatim as free-text body rather than parsed as a command. Always ends with a read-back-before-post confirm. Distinct from the Command grammar — it is the one place free text is accepted in Phase 1. See ADR-0012.
_Avoid_: free-form mode, transcription mode, NL input.

**Voice service**:
An external STT or TTS process the voice gateway calls over the generic HTTP contract (`/transcribe`, `/speak`) — Parakeet, Piper, a CPU fallback, or the mock. Located by config URL, pluggable, not an Adapter (it produces no Items). See ADR-0013.
_Avoid_: STT adapter, TTS adapter, speech engine.

### Preview Deck (Phase 2)

**Preview Deck**:
The Hub subsystem plus flat cockpit surface that boots, isolates, and shows disposable previews of declared agent/dev output. Labs/experimental and opt-in; it sits beside the world-model and never feeds it. See ADR-0015.
_Avoid_: sandbox panel, preview pane (informal only), preview manager.

**Preview**:
One live, ephemeral, origin-isolated rendering of a single booted Preview spec — `booting → ready → crashed → stopped`, then disposed. Explicitly **not** an Item: never persistent, never ranked, never in needs-me.
_Avoid_: preview item, instance (informal only), session.

**Preview spec**:
The declared recipe for a Preview — a registry entry naming the engine, the already-built image or compose to run, the port, a Trust lane, and an optional Item binding. Aspex *boots* a spec; it never computes or builds one. See ADR-0014.
_Avoid_: preview config, recipe, manifest.

**Preview broker**:
The Hub subsystem that boots Preview specs through a Preview engine, tracks each Preview's state, enforces the bounds (max-concurrent, CPU/memory, idle TTL), and reaps every container it spawned. The Preview-Deck analogue of the Voice gateway. See ADR-0017.
_Avoid_: orchestrator, supervisor, container manager.

**Preview engine**:
The pluggable backend that actually runs a Preview spec — Docker via the `docker` CLI in v1, a mock for tests, E2B/microsandbox later. Selected by config; not an Adapter (it produces no Items).
_Avoid_: runtime, sandbox provider, docker driver.

**Trust lane**:
Which surfacing path a Preview uses. v1 ships the **trusted-iframe lane** only — a first-party server rendered in a cross-origin, sandboxed iframe with no Hub credentials. The **pixels lane** (neko/WebRTC or screenshots) for untrusted/arbitrary output is deferred; until it lands, `untrusted` specs are not bootable. See ADR-0016.
_Avoid_: preview mode, render path.
