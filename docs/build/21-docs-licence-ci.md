# Card 21 — Docs, licence, dependency hygiene, CI

## Goal
Ship the releasable core honestly: the threat model, the schema/adapter docs, a README with a demo, the Apache-2.0 licence, a dependency-licence registry, and CI that runs typecheck + test + lint.

## Depends on
- All prior cards (this documents the finished Phase 0).

## Files to create
```
LICENSE                         # Apache-2.0 full text
NOTICE
README.md                       # replace the card-01 stub
CONTRIBUTING.md
docs/threat-model.md
docs/event-schema.md
docs/adapter-authoring.md
docs/licenses.md                # dependency licence registry
.github/workflows/ci.yml
```

## Content requirements

**`docs/threat-model.md`** — write up the §4 stance as shipped:
- Hard rule: the cockpit (Hub + web) **never executes agent-authored code** in its origin.
- Phase 0 reality: we render **data only** (text + links); no agent HTML/JS, no `eval`, no dynamic import of agent output.
- Origin/process isolation, "pixels not code", scene isolation — described as the **forward** plan for Labs previews (not built in Phase 0).
- Local-only posture: Hub binds `127.0.0.1`; no public ingress; github token stays local.

**`docs/event-schema.md`** — the `AttentionItem` contract (mirror `packages/schema` + the rung table + the `Signal` ingest shape). The canonical reference for adapter authors.

**`docs/adapter-authoring.md`** — how to write an Adapter: the interface, the id scheme, **attention ownership rules (ADR-0002)**, liveness expectations (ADR-0003: emit heartbeats), and the webhook body contract (card 17). Link the ADRs.

**`docs/licenses.md`** — every runtime dependency + its licence; assert **no AGPL/GPL** in the shipped core (per the plan's licence discipline). List: hono, @octokit/rest, react, react-dom, zustand, tailwindcss, vite, tauri (MIT/Apache), bun built-ins.

**`README.md`** — what Aspex is (attention triage, not an orchestrator), a demo GIF placeholder, quick start (`aspex hub --mock` → `tauri dev`), the **"personal project, best-effort support"** note, link to CONTEXT.md + ADRs.

**`.github/workflows/ci.yml`** — on push/PR: `oven-sh/setup-bun`, `bun install`, `bun run typecheck`, `bun test`, `bun run lint`.

## Acceptance check
```bash
bun install && bun run typecheck && bun test && bun run lint   # all green locally
```
- CI workflow is green on a fresh clone.
- `LICENSE` is Apache-2.0; `docs/licenses.md` lists deps with no AGPL/GPL.
- README quick-start steps actually work from a clean checkout.

## Out of scope / do NOT do
- Do not claim Labs features (voice, spatial, preview) exist — document them as **future** (link `90-later-phases-outline.md`).
- Do not add telemetry/analytics (Phase 0 promise: no telemetry).
- Do not relicense or pull in AGPL/GPL deps.
