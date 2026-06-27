# Aspex — Phase 0 Build Plan (Task Card Index)

This folder is the **buildable** form of the Aspex plan. Phase 0 — the releasable flat attention cockpit — is broken into small, ordered **task cards**. Each card is a self-contained job for one implementer (human or model). Build them **in order**; later cards depend on earlier ones.

Read this index fully before starting any card. It carries the rules that every card assumes.

---

## What Phase 0 delivers (Definition of Done)

> One command opens a local Aspex desktop app showing every GitHub PR / check / review that involves me **plus** every Claude Code session that needs me, ranked by what needs me most. I click an item, read a concise explanation, and **for GitHub** send a response/approval (approve / merge / comment / re-run) through the adapter; **for Claude Code** I see blocked/errored sessions and jump to the terminal to answer (read-only — see ADR-0004). The dashboard is calm by default and never silently wrong about liveness.

Phase 0 is **local-only**: no cloud, no account, no telemetry. A **mock/demo mode** lets you build and test the whole thing with no real agents.

---

## Locked decisions you must not relitigate

These are settled (see `../adr/`). Building against them is mandatory.

- **ADR-0001** — The world-model is **current-state Items upserted by stable id**, not an event stream. A poll result or hook POST is a **Signal** that upserts one Item.
- **ADR-0002** — **One unit of work never glows twice.** Attention is partitioned by lifecycle: per-agent adapters (claude-code, codex) own in-flight attention (`blocked`, `error`); the github adapter owns PR-lifecycle attention (review, CI, merge). A completed session is **Ambient**, not needs-me.
- **ADR-0003** — **Two-track liveness.** Polled sources: liveness = poll health. Push sources: liveness = heartbeat freshness (claude-code synthesizes heartbeats from `PostToolUse`). Terminal states never decay.
- **ADR-0004** — Phase 0 claude-code is **read-only** (deep-link only, no PTY). GitHub is two-way.
- **ADR-0005** — Phase 0 Hub is a **single Node process**: in-process bus, **SSE + REST**, **SQLite authoritative**. No NATS, no Socket.IO.
- **ADR-0006** — github discovery is **viewer-centric search** (`review-requested:@me`, `author:@me`, …), not repo enumeration.
- **ADR-0007** — The flat cockpit ships inside a **Tauri desktop app** from Phase 0 (desktop/DeX is first-class).
- **ADR-0008** — Hub↔Tauri: **separate processes in dev**, **Bun-compiled sidecar at release**. Hub code must stay Bun-compile-compatible (no Node-native addons).

Glossary of every domain term: `../../CONTEXT.md`. Use those words exactly (Item, Signal, State, Liveness, Reason, Needs-me, Ambient, Action, Deep-link, Adapter, Source, Provision, Hook-relay).

---

## Baked-in tech stack (do not substitute without an ADR)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | everywhere |
| Runtime + package manager + compiler | **Bun** | one tool: `bun install`, `bun run`, `bun test`, `bun build --compile`. Chosen so the Hub compiles to a sidecar binary (ADR-0008). |
| Monorepo | Bun workspaces | layout below |
| Hub HTTP / SSE | **Hono** | tiny, Bun-native, handles REST + SSE |
| Hub storage | **`bun:sqlite`** | built into Bun, no native addon — compiles cleanly |
| GitHub API | **Octokit** (REST + GraphQL) | conditional requests (ETags) for rate budget |
| Web UI | **Vite + React + Tailwind** | |
| Web state | **Zustand** | one store holds the world-model |
| Desktop shell | **Tauri v2** | hosts the web build; spawns Hub sidecar at release |
| Lint + format | **Biome** | single tool, fast, Bun-friendly |
| Tests | **`bun test`** | every card ships tests |

---

## Repository layout (created in card 01)

```
aspex/
  package.json            # Bun workspace root
  biome.json
  tsconfig.base.json
  apps/
    hub/                  # Node/TS (Bun) Hub: engine, adapters, HTTP, CLI
    web/                  # Vite + React flat dashboard
    desktop/              # Tauri v2 shell (added in card 19)
  packages/
    schema/              # AttentionItem, Adapter, Signal, liveness types + pure helpers
    adapter-github/
    adapter-claude-code/
    adapter-webhook/
    adapter-ntfy/
    ui/                  # shared React components (optional split; may live in apps/web early)
  examples/
    mock-events/         # scripted Signals for demo mode
  docs/
    adr/                 # decisions (already present)
    build/               # these task cards
    threat-model.md      # written in card 21
    event-schema.md
    adapter-authoring.md
```

---

## The canonical schema (the contract every card shares)

This is `packages/schema`. It is the renamed, decision-aligned successor to the plan's `AttentionEvent` (now **`AttentionItem`** — see ADR-0001). **Do not change these shapes without an ADR.**

```ts
export type Source = "github" | "claude-code" | "codex" | "webhook" | "ntfy" | "mcp";

export type ItemId = string; // stable, source-derived. e.g.
// "github:pr:owner/repo#42" | "claude-code:session:<uuid>" | "webhook:<key>"

export type State = "working" | "blocked" | "needs_review" | "done" | "error";
export type Liveness = "live" | "quiet" | "stale" | "lost";
export type Severity = "info" | "low" | "medium" | "high";
export type Risk = "safe" | "medium" | "dangerous";

// The single highest-priority condition that ranks an Item (one per Item — ADR grain rule).
export type Reason =
  | "blocked_on_human"   // rung 1
  | "failing_ci"         // rung 2
  | "review_requested"   // rung 3
  | "awaiting_merge"     // rung 4
  | "errored"            // treated within rung 1-2 band; see ladder in card 05
  | "ambient";           // rung 5 (working / informational)

export interface Action {
  id: string;
  label: string;
  risk: Risk;
  requiresConfirmation: boolean;
}

export interface Evidence {
  label: string;
  url?: string;
  text?: string;
}

export interface AttentionItem {
  id: ItemId;
  source: Source;
  project: string;
  session?: string;
  actor?: string;
  state: State;
  liveness: Liveness;
  reason: Reason;               // ranking driver; ONE per Item
  attentionRequired: boolean;   // true => eligible for needs-me
  severity: Severity;
  summary: string;              // deterministic template in Phase 0 (NO LLM)
  evidence: Evidence[];
  actions: Action[];            // may hold several (e.g. review + view-CI)
  deepLink?: string;            // read-only affordance (open PR / focus terminal)
  observedAt: string;          // ISO; last Signal that touched this Item
  staleAfter: string;          // ISO; when liveness should decay if not refreshed
}

// A Signal is what an adapter emits; the Hub upserts it into an AttentionItem.
// In Phase 0 a Signal IS a (partial) AttentionItem keyed by id; the engine fills
// derived fields (reason, attentionRequired, liveness defaults).
export type Signal = Partial<AttentionItem> & Pick<AttentionItem, "id" | "source" | "state">;
```

### Priority ladder (ranking for needs-me, highest first)

1. `blocked_on_human` — agent waiting on you
2. `failing_ci` — failing CI on a PR you own
3. `review_requested` — review requested on your PR
4. `awaiting_merge` — finished, awaiting merge/confirm
5. `ambient` — working / informational (**never** in needs-me)

`errored` is severity-weighted into the top band (card 05 specifies exact ordering). Within a rung, ties break by `severity` desc, then `observedAt` desc (newest first). Needs-me is **capped** (default 7; configurable); overflow is reachable via "show more".

---

## Global guardrails (apply to EVERY card)

1. **Never execute agent-authored code** in the Hub or web origin. Phase 0 renders only data (text, links). No `eval`, no dynamic `import()` of agent output, no rendering agent HTML. (Threat model: card 21.)
2. **Upsert by id, always.** Never insert a second row/card for the same real-world object. One Item per object (PR / session / issue).
3. **Respect attention ownership (ADR-0002).** Only the owning adapter sets `attentionRequired` for a given lifecycle stage. claude-code never sets `attentionRequired` for `done`.
4. **Liveness is never faked.** If a source is unreachable, decay it honestly (ADR-0003). A silently-wrong dashboard is the cardinal failure.
5. **No LLM in Phase 0.** All `summary`/`evidence` are deterministic templates. (Ollama/intent parsing is Phase 3.)
6. **Bun-compile-safe.** No Node-native addons in `apps/hub` or its deps; prefer Bun built-ins (`bun:sqlite`).
7. **Tests + acceptance check are part of the card.** A card is not done until its acceptance check passes.
8. **Stay in scope.** Each card has an "Out of scope" list. Do not build ahead.

---

## Card format

Every card has: **Goal · Depends on · Files · Interfaces/stubs · Steps · Acceptance check (runnable) · Out of scope**. Build one card per branch/PR.

---

## Phase 0 card list (build in this order)

**Foundation**
- `01` — Monorepo scaffold (Bun workspaces, Biome, tsconfig, folder skeleton)
- `02` — `packages/schema` (AttentionItem, Signal, Adapter interface, id + validation helpers)

**Hub core (no real adapters yet)**
- `03` — Hub: SQLite Item store (`bun:sqlite`, upsert-by-id, reload-on-restart)
- `04` — Hub: in-process bus + world-model service (apply Signals, emit diffs)
- `05` — Hub: attention engine (priority ladder, Reason, needs-me cap, Ambient split)
- `06` — Hub: liveness service (two-track decay, staleAfter, tick, terminal never decays)
- `07` — Hub: HTTP server (Hono — SSE diffs, `GET /state`, `POST /signals/:source`, `POST /actions/...`, `GET /health`)
- `08` — Hub: adapter registry + lifecycle (start/stop, route heartbeats + actions)
- `09` — Hub: config + `aspex` CLI (`aspex up`, `aspex hub`)

**Mock mode**
- `10` — Mock adapter + `examples/mock-events` (scripted Signals; demo mode)

**Web client**
- `11` — `apps/web` scaffold (Vite/React/Tailwind/Zustand + SSE client + reconnect)
- `12` — Web: needs-me inbox (ranked cards, calm-by-default, cap + show-more, Ambient section)
- `13` — Web: Item detail + actions (risk tiers, dangerous two-step confirm, deep-link)
- `14` — Web: liveness rendering (live/quiet/stale/lost; "working · stale" composite)

**Real adapters**
- `15` — `adapter-github` (viewer-centric search, check-runs, ETags, rate-limit aware, actions)
- `16` — `adapter-claude-code` (`aspex hooks install/uninstall`, `aspex hook-relay`, hook→Item map, read-only)
- `17` — `adapter-webhook` (generic localhost ingest)
- `18` — `adapter-ntfy` (out-channel: off-device alerts on high-severity needs-me transitions)

**Packaging + ship**
- `19` — Tauri shell `apps/desktop` (dev: hosts web build against localhost Hub)
- `20` — Sidecar packaging (`bun build --compile` Hub → Tauri sidecar; production launch)
- `21` — Docs + licence + CI (threat-model, event-schema, adapter-authoring, README+demo, Apache-2.0, dependency licence registry, CI)

**Later phases (outlined only, not yet chunked):** see `90-later-phases-outline.md` — Phase 1 voice (Parakeet/Piper/PTT), Phase 2 spatial Labs, Preview Deck, Phase 3 delegation + Ollama/Teach, Phase 4 Aura/Android XR + optional OSS release.
