# Phase 3 agent adapters (codex / opencode / cursor) are observe-only and own agent-local attention

Phase 3 wires three new Sources — **codex**, **opencode**, **cursor** — each as a normal [[Adapter]], under the existing attention-ownership rule (ADR-0002):

- **They own agent-local / in-flight attention only** — a session that is `working`, `blocked`, or `error` **before or without** a PR. **PR-lifecycle attention stays owned by the github adapter** (review, CI, merge), so one unit of work never glows twice. Where an agent's only signal is a PR, github already covers it; these adapters earn their place on the **pre-PR / non-PR** state.
- **Local-first ingestion:**
  - **codex** — via its `notify` external-program hook (JSON with `type`, `thread-id`) routed through the existing **`aspex hook-relay`**, the same pattern as claude-code. (Coarser than claude-code: codex `notify` currently fires on turn-complete, so codex Items update per-turn, not mid-turn — documented honestly.)
  - **opencode** — by subscribing to the local **`opencode serve` `/event` SSE** stream (project-scoped events: `session.created`, `message.updated`, …), mapping events to Signals and the stream's liveness to heartbeats.
  - **cursor** — see ADR-0022 (an opt-in inbound webhook lane).
- **Observe + deep-link, no control actions in v1.** Like the Phase 0 claude-code adapter (ADR-0004), these surface **State + Reason** and offer a **[[Deep-link]]** ("jump to the session"); they expose **no `runAction` control**. Two-way control of a coding agent is its own dangerous-action design and is **deferred to a future ADR**. Phase 3's "safe delegation" story is **free-form intent** (ADR-0018–0020), not agent remote-control.
- **Mock-first.** Each adapter ships recorded fixtures / a replay mode so every card and CI run passes with the real tool **absent** — the established invariant.

We rejected **fleshing out two-way control now** (the highest-risk surface; it deserves a dedicated pass) and a **single merged "agent adapter"** (the three have distinct ingestion shapes — push hook, local SSE, cloud webhook — so per-Source packages match the repo convention).
