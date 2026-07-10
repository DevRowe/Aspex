# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## North star (2026-07 realignment)

Aspex is the **augmented-reality layer for directing coding agents** - ambient supervision from AR/MR glasses, not a desktop cockpit.
Canonical framing lives in [README.md](README.md) and [CONTEXT.md](CONTEXT.md); do not reintroduce the old "attention-triage cockpit" / "mission control" / "delegation core" framing.

- **Face and protocol, never the orchestrator.** Aspex renders, ranks, and directs; an orchestrator (Giles is the reference backend) owns the agents. The Aspex-orchestrator protocol is in design.
- **Keep vs legacy.** KEEP and build on the Hub (`apps/hub`) and `@aspex/schema`. The desktop cockpit (`apps/web`, `apps/desktop`) and the Preview Deck (`apps/hub/src/preview`) are **legacy** - retained, not deleted; do not build new north-star work on them.
- **Honest capability.** Every coding-agent adapter is observe-only; GitHub is the only two-way adapter. The outbound direction channel does not exist yet - it is the next build. Do not describe the code as agentic beyond that.

## Build / test / lint

- Bun workspace. `bun install`, then `bun run typecheck`, `bun test`, `bun run lint` (biome). CI runs exactly these plus a Python voice-server mock contract.
- `noUncheckedIndexedAccess` is on; index and regex-group access is possibly-undefined.
- Long Markdown docs are written one sentence per line.

## Sharp edges

- **Hub API auth (ADR-0023).** Every HTTP/SSE endpoint requires a local bearer token; the Hub generates one into `~/.aspex/config.json` on first boot or reads `ASPEX_HUB_TOKEN`. Clients send `Authorization: Bearer`; the SSE stream also accepts `?token=` (EventSource cannot set headers). `POST /webhooks/cursor` is the one exemption (own HMAC, ADR-0022). Local callers (`aspex hook-relay`, `aspex preview list`, the claude-code relay) must present the token. `buildApp` enforces only when `authToken` is set, so most tests run unauthenticated; the real boot path always supplies one.
- **Sidecar binaries are build artifacts.** `apps/desktop/src-tauri/binaries/` is gitignored (except its README); never commit compiled Hub sidecars (`bun build --compile`). A 95 MB `.exe` was removed from the tip but still lives in history - rewriting it out is a separate owner-approved op.
