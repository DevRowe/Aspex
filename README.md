# Aspex

Aspex is a local-first attention triage cockpit for coding agents and adjacent
developer workflows. It shows the current world-model of Items from upstream
tools, ranks what needs you, and offers safe responses where an adapter has an
official action path.

Aspex is not an orchestrator. It does not start, schedule, or supervise agents.
Phase 0 consumes signals from tools such as GitHub, Claude Code hooks, mock
events, and local webhooks, then renders data in a desktop cockpit.

Phase 0 is local-only: no cloud account, no telemetry, and no public ingress.
The Hub binds to `127.0.0.1`, stores state locally, and keeps any GitHub token on
your machine.

Demo GIF placeholder: add `docs/assets/aspex-demo.gif` before a public release.

## Quick Start

Install dependencies:

```sh
bun install
```

Run the mock Hub:

```sh
bun apps/hub/src/cli.ts hub --mock
```

In another terminal, run the web UI:

```sh
bun run --cwd apps/web dev
```

For desktop development, keep the Hub running and start Tauri:

```sh
bun run --cwd apps/desktop dev
```

Build the web UI and desktop shell:

```sh
bun run --cwd apps/web build
bun run --cwd apps/desktop build
```

## Real Adapters

GitHub uses a local token from config or `ASPEX_GITHUB_TOKEN` and supports
two-way actions such as approve, merge, comment, and re-run where GitHub allows
them.

Claude Code is read-only in Phase 0. Aspex can surface blocked or errored
sessions and provide a deep-link/focus affordance, but you answer in your own
terminal.

Generic webhooks accept local `POST /signals/webhook` data for small custom
integrations.

## Project Notes

- Domain language lives in [CONTEXT.md](CONTEXT.md).
- Architecture decisions live in [docs/adr](docs/adr).
- Phase 0 build cards live in [docs/build](docs/build).
- Security posture is documented in [docs/threat-model.md](docs/threat-model.md).
- Adapter contracts are documented in [docs/adapter-authoring.md](docs/adapter-authoring.md).
- Event schema is documented in [docs/event-schema.md](docs/event-schema.md).
- Dependency licenses are tracked in [docs/licenses.md](docs/licenses.md).

This is a personal project with best-effort support. Issues and patches are
welcome, but there is no support SLA.
