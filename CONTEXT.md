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
