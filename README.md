# Aspex

Aspex is the augmented-reality layer for directing coding agents.
The goal is ambient supervision on the go: your agents work, their needs and results find you wherever you are, and you glance, speak, and keep moving - supervising and steering an agent fleet from AR/MR glasses instead of the desk.

This is a north-star realignment (2026-07).
The tested backend below - the Hub, the `@aspex/schema` wire contract, attention ranking, liveness, the HTTP/SSE protocol, and the voice loop - is real and carries forward.
The desktop cockpit it grew up inside is now legacy (see [Legacy surfaces](#legacy-surfaces)); the Preview Deck that sat beside it has been removed.
The Hub-side half of the outbound direction channel - the orchestrator protocol core and the reference Giles adapter - is now built; the Giles-side consumer is a parallel build against the same design.

## The vision in one page

**Killer moment: ambient supervision on the go.**
Not spatial mission-control at a desk, not point-at-code direction - those can grow out of this later.
The first thing that has to work is a blocked agent finding you in another room, you glancing at a summarized card, approving by voice, and moving on.

**Face and protocol, never the orchestrator.**
Aspex renders, ranks, and directs.
A chief-of-staff orchestrator owns the agents; Giles is the first and reference backend.
The contract between them - status and attention streaming in, direction intents flowing out - is the product.
The Hub-side half of that protocol is built (design report: giles task `aspex-protocol-design-d1`): orchestrator items stream into the world-model, item-scoped direction verbs ride `POST /actions` with its confirmation gate, and the two referent-less verbs (dispatch, status query) ride the new `POST /intents`.
Aspex still never mutates a project itself: the Giles direction channel only queues intent files that Giles executes through its own sanctioned helpers.

**Two client tiers, one backend.**
Text at code size is not readable on today's glasses, so everything wearer-facing is a summarized card, never a raw diff.

- **Glance tier (now):** attention cards plus push-to-talk voice, driven by a phone with today's display glasses.
  This runs on hardware you can buy today.
- **Spatial tier (later):** placed panels, gaze, and pinch, lit up on Aura-class hardware (lightweight glasses with a wide FOV, hand tracking, and app-controlled dimming - the Project Aura / Android XR capability envelope expected late 2026).

**Topology: Hub on the dev box, glasses over a private tailnet next.**
The Hub runs on the same machine as your agents, holds the world-model, and stays local-first - no cloud relay in the MVP.
By default the Hub binds `127.0.0.1` and the browser CORS allowlist is localhost/Tauri-only, so out-of-the-box access is same-machine.
To let glasses reach it over a private [Tailscale](https://tailscale.com)-style tailnet, set the bind address (`hubBind` in config or `ASPEX_HUB_BIND`, e.g. the dev box's tailnet address) and, for a browser client such as the HL2 Edge lab client, one extra exact CORS origin (`corsOrigin` or `ASPEX_HUB_CORS_ORIGIN`).
Every endpoint requires the local auth token, so the API is not wide open when that tailnet reachability is enabled (see [Hub API auth](#hub-api-auth)).

**Two client tracks: lab first.**

- **Lab track (throwaway):** a WebXR client in HoloLens 2's Edge browser.
  An HL2 has articulated hand tracking, voice, and waveguides - an Aura-class simulator available years early.
  This code is a design instrument, never load-bearing, never a supported target; HL2 is a discontinued platform.
- **Product track:** an Android XR-ready glance-tier app - phone plus today's glasses as the display now, spatial tier on Aura-class hardware later.

**Posture: open protocol, open reference stack, demo-first.**
The plan is to stay quiet until the lab produces one undeniable artifact - a continuous, unedited demo of three ambient-supervision moments reproduced on-face during ordinary life - then launch the protocol and the demo together.
Nobody occupies the AR-agent-direction space yet; the differentiation is what only glasses can do.

## Architecture

```
 coding agents          orchestrator            Aspex Hub            client tiers
 (Claude Code,   --->   (Giles: first    --->   (world-model,  --->  glance tier (now):
  codex, GitHub,         reference             ranking,             cards + voice
  opencode, ...)         backend; owns          liveness,           spatial tier (later):
                         the agents)            HTTP/SSE,           placed panels on
                         direction intents      voice loop,          Aura-class glasses
                         flow back out <---      auth token)   <---  tailnet target
                                                                    (loopback bind by default)
```

- The **Hub** is a single local process: an in-process bus, SSE for one-way world-model diffs, a small REST API for control, and SQLite as the authoritative store (ADR-0005).
- **Adapters** ingest Signals from each Source into the world-model.
  They are observe-first: every coding-agent adapter (Claude Code, codex, opencode, cursor) is observe-only and offers a deep-link, not an action.
  GitHub and the Giles orchestrator are the only two-way surfaces.
- An **Orchestrator** is a first-class contract distinct from an Adapter (`packages/schema/src/orchestrator.ts`): a bidirectional peer that owns agents, streaming `orchestrator:<orchId>:<taskId>` items in and accepting direction intents out.
- The **outbound direction channel** carries the direction verbs (approve/deny, answer a blocked question, redirect in-flight work, dispatch new work, status query, review-and-ship) back through the orchestrator.
  Item-scoped verbs ride the existing `POST /actions/:itemId/:actionId` with its confirmation gate; only dispatch and status query use the new `POST /intents`.
  Consequential verbs ride the Hub's existing arm/confirm stack rather than a new confirmation framework, and every intent carries a client `intentId` that the Hub's `IntentLedger` dedupes end-to-end so a retried ship cannot double-merge.

Domain language lives in [CONTEXT.md](CONTEXT.md) and architecture decisions in [docs/adr](docs/adr).

## Quick Start

Install dependencies:

```sh
bun install
```

Run the mock Hub:

```sh
bun apps/hub/src/cli.ts hub --mock
```

The Hub prints its address and, on first boot, generates a local API token in
`~/.aspex/config.json`.
See [Hub API auth](#hub-api-auth) for how a client presents it.

## Real Adapters

GitHub uses a local token from config or `ASPEX_GITHUB_TOKEN` and supports
two-way actions such as approve, merge, comment, and re-run where GitHub allows
them.

Claude Code is observe-only.
Aspex can surface blocked or errored sessions and provide a deep-link/focus
affordance, but you answer in your own terminal until the direction channel ships.

Generic webhooks accept local `POST /signals/webhook` data for small custom
integrations.

Codex is observe-only.
When enabled, its notify hook can feed local session turn-completion state
through `aspex hook-relay`; Aspex shows ambient session liveness and deep-links
only.

OpenCode is observe-only.
When enabled, Aspex subscribes to a local `opencode serve` `/event` stream and
shows session state and deep-links only.

Cursor is observe-only.
When enabled with a shared secret, Aspex accepts signed `statusChange` webhook
payloads at the local Hub and shows agent-local status and deep-links only.
Aspex does not expose the Hub publicly for you.

## Giles Orchestrator

Giles is the reference Orchestrator backend and, alongside GitHub, one of the
two two-way surfaces.
It is opt-in and default off; enable it with `orchestrators.giles.enabled` in
config or with environment variables:

```sh
ASPEX_GILES_ENABLED=true \
ASPEX_GILES_HOME=~/giles \
bun apps/hub/src/cli.ts hub
```

`ASPEX_GILES_POLL_INTERVAL_MS` tunes the poll cadence.
The adapter reads the Giles home read-only and streams in-flight tasks as
`orchestrator:giles:<taskId>` items.
Direction verbs (approve/deny, answer, redirect, dispatch, status query,
review-and-ship) are queued as intent files in the designated
`state/aspex-inbox/` delivery directory for Giles to execute through its own
sanctioned helpers; Aspex itself never mutates a project.

## HoloLens 2 WebXR lab

The standalone client in `apps/hl2-lab` is an unsupported, lab-only design instrument for testing glance cards, gaze/pinch, push-to-talk, and session-safe direction against the real Hub/orchestrator protocol.
It is deliberately isolated from the legacy cockpit and is not a supported product target.
Run the desktop simulator with `bun run --cwd apps/hl2-lab dev`, type-check it with `bun run --cwd apps/hl2-lab typecheck`, build it with `bun run build:hl2-lab`, and follow the pairing and on-device checklist in [docs/hl2-lab.md](docs/hl2-lab.md).

## Hub API auth

By default the Hub binds `127.0.0.1` and the browser CORS allowlist is localhost/Tauri-only, so it is same-machine unless you opt in.
`hubBind`/`ASPEX_HUB_BIND` opens the bind address (for glasses on a private tailnet) and `corsOrigin`/`ASPEX_HUB_CORS_ORIGIN` allows one extra exact browser origin.
Because the Hub can be made reachable beyond loopback, every HTTP and SSE endpoint requires a locally generated bearer token.
When the Hub binds a specific interface, the bundled local CLI caller (`aspex hook-relay`) dials that same address automatically.
On first boot the Hub generates a token and stores it in `~/.aspex/config.json` under `auth.token`.
You can also supply one through the `ASPEX_HUB_TOKEN` environment variable, which takes precedence and is never written to disk.
When you supply `ASPEX_HUB_TOKEN`, make the same environment variable available
to every local caller that must reach the Hub, such as `aspex hook-relay`,
because the token is intentionally not persisted for them to read.

Clients present it two ways:

- **Most endpoints:** an `Authorization: Bearer <token>` header.
- **The SSE stream:** a `?token=<token>` query parameter, because the browser
  `EventSource` API cannot set request headers.
  The query-parameter path is the documented tradeoff for SSE and is otherwise
  equivalent to the header.

The one exception is `POST /webhooks/cursor`: it authenticates with its own
per-request HMAC signature (ADR-0022) because it is reached by Cursor's cloud,
which cannot hold the local token.

The token is a same-machine credential today and a future same-tailnet credential, not a public authentication system.
See [docs/adr/0023-hub-api-requires-a-local-bearer-token.md](docs/adr/0023-hub-api-requires-a-local-bearer-token.md)
and [docs/threat-model.md](docs/threat-model.md).

## Voice Quick Start

Voice is opt-in and is the glance-tier interaction verb.
For a no-GPU smoke test, enable mock voice:

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

`ASPEX_VOICE_STT` may contain comma-separated fallback endpoints.
Endpoint values can be service base URLs or explicit `/transcribe` and `/speak`
contract URLs; the Hub normalizes them.

You hold a push-to-talk control to capture one Utterance and release to send it
to the Hub.
The Hub returns text read-back every time and plays TTS when configured.
The shipped grammar is documented in [docs/voice-grammar.md](docs/voice-grammar.md).

## Free-Form Intent Quick Start

Free-form intent is opt-in and fallback-only.
The closed grammar runs first; only `unknown_command` falls through to the local
Intent service.
Mock mode needs no GPU, no Ollama, and no model weights:

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

Actions interpreted through free-form intent are read back before dispatch, and
the confirm step remains separate.
More detail is in [docs/free-form-intent.md](docs/free-form-intent.md).

## Adapter Enabling

The observe-only agent adapters are opt-in and default off:

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

These adapters do not run commands in codex, opencode, or Cursor, and they do
not own GitHub PR lifecycle attention.

## Legacy surfaces

Subsystems built inside the original "desktop attention-triage cockpit"
framing are kept for reference during the pivot, not deleted, unless noted
otherwise below.
New work should not build on them; the client future is the AR tracks above.

- **Desktop cockpit (`apps/web`, `apps/desktop`).**
  The React cockpit and Tauri desktop shell (ADR-0007, ADR-0008) are a
  flat-screen skin over the Hub.
  They still run against the Hub for development, but the display target is now
  the two client tracks (HL2 WebXR lab, Android XR product), and the cockpit is
  no longer the product surface.
  The retained desktop shell and web client present the Hub API token through
  the Tauri `hub_token` command, browser `Authorization` headers, and SSE
  `?token=` stream URLs so the legacy path still works while deprecated.

- **Preview Deck (removed).**
  The Preview Deck (ADR-0014 through ADR-0017) booted disposable,
  origin-isolated previews of agent output.
  It sat beside the world-model and never fed it - a different product from
  ambient supervision - and was removed on 2026-07-17.
  The full implementation is recoverable from git history at commit `2e60875`.

## Project Notes

- Domain language lives in [CONTEXT.md](CONTEXT.md).
- Architecture decisions live in [docs/adr](docs/adr).
- Build cards live in [docs/build](docs/build).
- Security posture is documented in [docs/threat-model.md](docs/threat-model.md).
- Adapter contracts are documented in [docs/adapter-authoring.md](docs/adapter-authoring.md).
- Event schema is documented in [docs/event-schema.md](docs/event-schema.md).
- Free-form intent is documented in [docs/free-form-intent.md](docs/free-form-intent.md).
- Dependency licenses are tracked in [docs/licenses.md](docs/licenses.md).

This is a personal project with best-effort support.
Issues and patches are welcome, but there is no support SLA.
