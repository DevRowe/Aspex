# Aspex

Aspex is the augmented-reality layer for directing coding agents.
The goal is ambient supervision on the go: your agents work, their needs and results find you wherever you are, and you glance, speak, and keep moving - supervising and steering an agent fleet from AR/MR glasses instead of the desk.

This is a north-star realignment (2026-07).
The tested backend below - the Hub, the `@aspex/schema` wire contract, attention ranking, liveness, the HTTP/SSE protocol, and the voice loop - is real and carries forward.
The desktop cockpit and Preview Deck it grew up inside are now legacy (see [Legacy surfaces](#legacy-surfaces)), and the outbound direction channel that the vision needs is the next build, not something shipped today.

## The vision in one page

**Killer moment: ambient supervision on the go.**
Not spatial mission-control at a desk, not point-at-code direction - those can grow out of this later.
The first thing that has to work is a blocked agent finding you in another room, you glancing at a summarized card, approving by voice, and moving on.

**Face and protocol, never the orchestrator.**
Aspex renders, ranks, and directs.
A chief-of-staff orchestrator owns the agents; Giles is the first and reference backend.
The contract between them - status and attention streaming in, direction intents flowing out - is the product.
That protocol is in design; its ADR will land alongside the first adapter.
Today's codebase is honest about the gap: it observes and ranks well, but nothing in it can yet send an instruction to a running agent.

**Two client tiers, one backend.**
Text at code size is not readable on today's glasses, so everything wearer-facing is a summarized card, never a raw diff.

- **Glance tier (now):** attention cards plus push-to-talk voice, driven by a phone with today's display glasses.
  This runs on hardware you can buy today.
- **Spatial tier (later):** placed panels, gaze, and pinch, lit up on Aura-class hardware (lightweight glasses with a wide FOV, hand tracking, and app-controlled dimming - the Project Aura / Android XR capability envelope expected late 2026).

**Topology: Hub on the dev box, glasses over a private tailnet.**
The Hub runs on the same machine as your agents, holds the world-model, and stays local-first - no cloud relay in the MVP.
The glasses reach it over a private [Tailscale](https://tailscale.com)-style tailnet.
Because the Hub is no longer pure-localhost, its API now requires a local auth token (see [Hub API auth](#hub-api-auth)).

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
                         flow back out <---      auth token)   <---  over a private tailnet
```

- The **Hub** is a single local process: an in-process bus, SSE for one-way world-model diffs, a small REST API for control, and SQLite as the authoritative store (ADR-0005).
- **Adapters** ingest Signals from each Source into the world-model.
  Today they are observe-first: GitHub is two-way (approve, merge, comment, re-run); every coding-agent adapter (Claude Code, codex, opencode, cursor) is observe-only and offers a deep-link, not an action.
- The **outbound direction channel** - the six direction verbs (approve/deny, answer a blocked question, redirect in-flight work, dispatch new work, status query, review-and-ship) acting back through the orchestrator - is greenfield work defined by the forthcoming protocol ADR.
  Consequential verbs will ride the Hub's existing arm/confirm voice state machine rather than a new confirmation framework.

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

## Hub API auth

The Hub is designed to be reachable from glasses over a private tailnet, so every
HTTP and SSE endpoint requires a locally generated bearer token.
On first boot the Hub generates a token and stores it in `~/.aspex/config.json`
under `auth.token`; you can also supply one through the `ASPEX_HUB_TOKEN`
environment variable, which takes precedence and is never written to disk.

Clients present it two ways:

- **Most endpoints:** an `Authorization: Bearer <token>` header.
- **The SSE stream:** a `?token=<token>` query parameter, because the browser
  `EventSource` API cannot set request headers.
  The query-parameter path is the documented tradeoff for SSE and is otherwise
  equivalent to the header.

The one exception is `POST /webhooks/cursor`: it authenticates with its own
per-request HMAC signature (ADR-0022) because it is reached by Cursor's cloud,
which cannot hold the local token.

The token is a same-machine / same-tailnet credential, not a public
authentication system.
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

Two subsystems were built inside the original "desktop attention-triage cockpit"
framing and are kept for reference during the pivot, not deleted.
New work should not build on them; the client future is the AR tracks above.

- **Desktop cockpit (`apps/web`, `apps/desktop`).**
  The React cockpit and Tauri desktop shell (ADR-0007, ADR-0008) are a
  flat-screen skin over the Hub.
  They still run against the Hub for development, but the display target is now
  the two client tracks (HL2 WebXR lab, Android XR product), and the cockpit is
  no longer the product surface.
  A legacy client must also present the Hub API token; the cockpit predates that
  requirement and is not wired for it.

- **Preview Deck (`apps/hub/src/preview`).**
  The Preview Deck (ADR-0014 through ADR-0017) boots disposable, origin-isolated
  previews of agent output.
  It is real, tested, opt-in code that sits beside the world-model and never
  feeds it - a different product from ambient supervision.
  It is documented in [docs/preview-deck.md](docs/preview-deck.md) and retained,
  but it is out of the north-star path.
  This README previously omitted it entirely; it is called out here so the
  documented surface area matches the code.

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
