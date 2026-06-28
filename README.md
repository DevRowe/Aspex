# Aspex

Aspex is a local-first attention triage cockpit for coding agents and adjacent
developer workflows. It shows the current world-model of Items from upstream
tools, ranks what needs you, and offers safe responses where an adapter has an
official action path.

Aspex is not an orchestrator. It does not start, schedule, or supervise agents.
Phase 0 consumes signals from tools such as GitHub, Claude Code hooks, mock
events, and local webhooks, then renders data in a desktop cockpit. Phase 1 adds
optional flat push-to-talk voice for the same cockpit. Phase 3 adds opt-in
free-form intent and observe-only codex, opencode, and cursor adapters.

Aspex is local-only by default: no cloud account, no telemetry, and no automatic
public ingress. The Hub binds to `127.0.0.1`, stores state locally, and keeps
tokens on your machine. Cursor webhooks are opt-in and require the user to make
their own ingress choice.

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

Codex is observe-only. When enabled, its notify hook can feed local session
turn-completion state through `aspex hook-relay`; Aspex shows ambient session
liveness and deep-links only.

OpenCode is observe-only. When enabled, Aspex subscribes to a local
`opencode serve` `/event` stream and shows session state and deep-links only.

Cursor is observe-only. When enabled with a shared secret, Aspex accepts signed
`statusChange` webhook payloads at the local Hub and shows agent-local status
and deep-links only. Aspex does not expose the Hub publicly for you.

## Phase 1 Voice Quick Start

Voice is opt-in. For a no-GPU smoke test, enable mock voice:

```sh
ASPEX_VOICE_ENABLED=1 ASPEX_VOICE_MOCK=1 bun apps/hub/src/cli.ts voice check
ASPEX_VOICE_ENABLED=1 ASPEX_VOICE_MOCK=1 bun apps/hub/src/cli.ts hub --mock
```

When using an installed CLI, the same check is `aspex voice check`.

For real local or tailnet STT/TTS, run the reference server in
[services/voice-server](services/voice-server/README.md), then point the Hub at
it:

```sh
ASPEX_VOICE_ENABLED=1 \
ASPEX_VOICE_STT=http://127.0.0.1:8901/transcribe \
ASPEX_VOICE_TTS=http://127.0.0.1:8901/speak \
bun apps/hub/src/cli.ts voice check
```

`ASPEX_VOICE_STT` may contain comma-separated fallback endpoints. Endpoint
values can be service base URLs or explicit `/transcribe` and `/speak` contract
URLs; the Hub normalizes them.

In the web cockpit, hold the voice button or hold `Space` to record one
Utterance. Release to send it to the Hub. The Hub returns text read-back every
time and plays TTS when configured. The shipped grammar is documented in
[docs/voice-grammar.md](docs/voice-grammar.md).

## Phase 3 Free-Form Intent Quick Start

Free-form intent is opt-in and fallback-only. The closed grammar runs first;
only `unknown_command` falls through to the local Intent service. Mock mode
needs no GPU, no Ollama, and no model weights:

```sh
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun apps/hub/src/cli.ts intent check
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun apps/hub/src/cli.ts hub --mock
```

With an installed CLI:

```sh
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 aspex intent check
```

For a real local Ollama service:

```sh
ASPEX_INTENT_ENABLED=1 \
ASPEX_INTENT_ENDPOINTS=http://127.0.0.1:11434 \
ASPEX_INTENT_MODEL=llama3.1 \
bun apps/hub/src/cli.ts intent check
```

Then type a natural-language command into the Intent bar in the web cockpit.
Actions interpreted through free-form intent are read back before dispatch, and
the confirm step remains separate.

More detail is in [docs/free-form-intent.md](docs/free-form-intent.md).

## Phase 3 Adapter Enabling

All new Phase 3 adapters are opt-in and default off:

```sh
ASPEX_CODEX_ENABLED=1 bun apps/hub/src/cli.ts hub
```

```sh
ASPEX_OPENCODE_ENABLED=1 \
ASPEX_OPENCODE_SERVER_URL=http://127.0.0.1:4096 \
bun apps/hub/src/cli.ts hub
```

```sh
ASPEX_CURSOR_ENABLED=1 \
ASPEX_CURSOR_SECRET=replace-with-a-shared-secret \
bun apps/hub/src/cli.ts hub
```

These adapters are observe-only in this phase. They do not run commands in
codex, opencode, or Cursor, and they do not own GitHub PR lifecycle attention.

## Project Notes

- Domain language lives in [CONTEXT.md](CONTEXT.md).
- Architecture decisions live in [docs/adr](docs/adr).
- Phase 0 build cards live in [docs/build](docs/build).
- Security posture is documented in [docs/threat-model.md](docs/threat-model.md).
- Adapter contracts are documented in [docs/adapter-authoring.md](docs/adapter-authoring.md).
- Event schema is documented in [docs/event-schema.md](docs/event-schema.md).
- Free-form intent is documented in [docs/free-form-intent.md](docs/free-form-intent.md).
- Dependency licenses are tracked in [docs/licenses.md](docs/licenses.md).

This is a personal project with best-effort support. Issues and patches are
welcome, but there is no support SLA.
