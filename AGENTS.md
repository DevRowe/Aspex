# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## North star (2026-07 realignment)

Aspex is the **augmented-reality layer for directing coding agents** - ambient supervision from AR/MR glasses, not a desktop cockpit.
Canonical framing lives in [README.md](README.md) and [CONTEXT.md](CONTEXT.md); do not reintroduce the old "attention-triage cockpit" / "mission control" / "delegation core" framing.

- **Face and protocol, never the orchestrator.** Aspex renders, ranks, and directs; an orchestrator (Giles is the reference backend) owns the agents. The Hub-side protocol core is built (see "Orchestrator protocol" below); the Giles-side consumer is a parallel build against the same design.
- **Keep vs legacy.** KEEP and build on the Hub (`apps/hub`) and `@aspex/schema`. The desktop cockpit (`apps/web`, `apps/desktop`) is **legacy** - retained, not deleted; do not build new north-star work on it. The Preview Deck was removed 2026-07-17, recoverable at commit `2e60875`.
- **Honest capability.** Every coding-agent adapter is observe-only; GitHub and the Giles orchestrator are the only two-way surfaces. The Giles direction channel only queues intent files for Giles to execute through its own sanctioned helpers; Aspex itself never mutates a project.

## Orchestrator protocol

The Hub-side half of the Aspex-orchestrator protocol (design report: giles task `aspex-protocol-design-d1`) is implemented as three deltas, not a rewrite.

- **`Orchestrator` is a first-class contract, not an `Adapter` extension** (`packages/schema/src/orchestrator.ts`): item-scoped methods match `Adapter` so `/actions` routing reuses the registries, plus `dispatch`/`query` for the two referent-less verbs.
- **World-model IN**: one new `Source` value `"orchestrator"`; item ids are `orchestrator:<orchId>:<taskId>` (`orchestratorItemId`); zero new `State`/`Reason`/`Severity` members - the Giles lifecycle maps onto the existing vocabulary in `packages/adapter-giles/src/map.ts`.
- **Direction OUT**: item-scoped verbs (approve/deny/answer/redirect/ship) ride the existing `POST /actions/:itemId/:actionId` with its confirmation gate; only dispatch and status_query use the new `POST /intents`.
- **Idempotency (design 2.6)**: every intent carries a client `intentId` (filename-safe by construction, `isValidIntentId`); the Hub's `IntentLedger` LRU replays the cached ack on retry, and `/actions` threads the `intentId` into the payload so the adapter reuses it as the inbox filename - end-to-end dedupe, so a retried ship cannot double-merge.
- **`packages/adapter-giles` reads the Giles home READ-ONLY** and writes only into the designated `state/aspex-inbox/` delivery dir (atomic write-then-rename). Current worker state comes from `bin/giles-worker-state.sh`; the append-only `state/<id>.status` log is never tailed for state (it only disambiguates parked-on-gate vs needs-decision and supplies the human note).
- **Enablement**: off by default; `orchestrators.giles.enabled` in config or `ASPEX_GILES_ENABLED=true` (+ `ASPEX_GILES_HOME`, `ASPEX_GILES_POLL_INTERVAL_MS`). Orchestrator items use poll-health liveness like GitHub (`POLLED` in `apps/hub/src/engine/liveness.ts`).
- **Protocol v1.1 conventions** (ADR-0024, client contract in [docs/hub-api.md](docs/hub-api.md)): all error bodies are RFC 9457 problem+json (branch on `urn:aspex:problem:*` types, legacy `message` kept); SSE has monotonic ids, `Last-Event-ID` replay, and a named `ping` event; `Idempotency-Key` header aligns with the body `intentId` (same-key-different-payload is 422); `GET /state` advertises `apiVersion`; optional `tls` config serves https for the tailnet. Evolution is additive-only - clients must ignore unknown fields and event types.

## Build / test / lint

- Bun workspace. `bun install`, then `bun run typecheck`, `bun test`, `bun run lint` (biome). CI runs exactly these plus a Python voice-server mock contract.
- `noUncheckedIndexedAccess` is on; index and regex-group access is possibly-undefined.
- **Shared primitives live in `@aspex/schema`.** Payload guards/extractors (`isRecord`, `stringField`, `trimmedStringField`, `stringAt`, `projectFromCwd`, `errorMessage`) are in `packages/schema/src/guards.ts`, and all item-id constructors in `packages/schema/src/ids.ts`; import these instead of redefining them in an adapter or hub module.
- **Hub config is one zod v4 schema** (`apps/hub/src/config.ts`): defaults live inline via `.default()`/`.prefault()`, env vars map through its `ENV_OVERRIDES` table, and boot errors are formatted from ZodError paths - extend the schema and table there instead of adding hand-rolled parsers or `DEFAULT_*` constants.
- Long Markdown docs are written one sentence per line.
- **XR lab commands.** `apps/xr-lab` is an unsupported, lab-only, device-neutral WebXR design instrument (Android XR primary target, HL2 demoted to a wear-test jig), never a product target or a legacy-cockpit extension; use `bun run --cwd apps/xr-lab dev`, `bun run build:xr-lab`, and `bun run test:xr-lab`, with capability-gated input in `apps/xr-lab/src/capabilities.ts` and on-device pairing and wear-test notes in `docs/xr-lab.md`.

## Sharp edges

- **Hub API auth (ADR-0023).** Every HTTP/SSE endpoint requires a local bearer token; the Hub generates one into `~/.aspex/config.json` on first boot or reads `ASPEX_HUB_TOKEN`. Clients send `Authorization: Bearer` everywhere, including the SSE stream (both first-party clients use fetch-based SSE via `eventsource-parser`); the stream's `?token=` query is deprecated - it survives only as the native-EventSource escape hatch until after the owner's on-device wear test. `POST /webhooks/cursor` is the one exemption (own HMAC, ADR-0022). Local callers (`aspex hook-relay`, the claude-code relay) must present the token. `buildApp` enforces only when `authToken` is set, so most tests run unauthenticated; the real boot path always supplies one.
- **Sidecar binaries are build artifacts.** `apps/desktop/src-tauri/binaries/` is gitignored (except its README); never commit compiled Hub sidecars (`bun build --compile`). A 95 MB `.exe` was removed from the tip but still lives in history - rewriting it out is a separate owner-approved op.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
