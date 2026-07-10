# Threat Model

This document describes the security stance as shipped through Phase 3 and the
orchestrator protocol core. It is scoped to the local Hub, web cockpit, desktop
shell, Phase 0 adapters, the Phase 1 flat voice loop, the isolated HoloLens 2
WebXR lab, the Phase 2 Preview Deck, Phase 3 free-form intent plus observe-only
agent adapters, and the Hub-side orchestrator direction channel.

## Security Goals

- Show the user what needs attention without executing untrusted work.
- Keep the system local-first: no cloud service, no account, no telemetry.
- Keep credentials local to the user's machine.
- Make liveness honest rather than silently stale.
- Route only explicit, adapter-owned actions to official upstream APIs.

## Hard Rule: Data Only

The Hub and web cockpit never execute agent-authored code. Phase 0 renders data
only: text, timestamps, reasons, evidence, links, and action metadata.

Disallowed in the Hub and web origin:

- Agent-authored HTML.
- Agent-authored JavaScript.
- `eval` or equivalent string execution.
- Dynamic import of agent output.
- Installing or loading code from an adapter payload.
- Treating preview content as trusted cockpit UI.

Summaries and evidence are deterministic templates in Phase 0. Phase 3 adds an
opt-in local LLM Intent service, but it returns constrained Intents only; it is
not a summarization or command-execution path.

## Local-Only Boundary

The Hub binds `127.0.0.1` by default and is then same-machine only.
The browser CORS origin policy is localhost/Tauri-only by default.
Under the north-star realignment glasses reach the Hub over a private tailnet: the operator opts in by setting the bind address (`hubBind`/`ASPEX_HUB_BIND`, e.g. the dev box's tailnet address) and, for a browser client, at most one extra exact CORS origin (`corsOrigin`/`ASPEX_HUB_CORS_ORIGIN`).
So "on the box" no longer implies "is the user"; the bearer token below is the compensating control.
There is still no automatic public ingress: nothing in Aspex binds a public interface or opens a tunnel for you.

The desktop shell and web client talk to the local Hub over REST and SSE.
The Hub stores state locally in SQLite.
A GitHub token, when configured, stays local in config or environment variables and is used only by the GitHub adapter.

The webhook adapter is also local ingest. It accepts data for the local Hub; it
does not make generic webhook actions writable in Phase 0.

## Hub API Auth

Because the Hub can be made reachable over a tailnet rather than pure loopback, every HTTP and SSE endpoint requires a locally generated bearer token (ADR-0023).
The token landed before the bind-address and CORS origin-policy change so a tailnet peer cannot read the world-model, dispatch actions, or inject Signals without it.

The token is generated on first boot and stored in `~/.aspex/config.json`, or supplied through `ASPEX_HUB_TOKEN`, which takes precedence and is never written to disk.
It is a same-machine credential today and a future same-tailnet credential, not a public authentication system: one token, no accounts or sessions.
When `ASPEX_HUB_TOKEN` is supplied, the operator must provide that environment
variable to every local caller that should reach the Hub, such as Claude Code
hook relay processes, because env tokens are intentionally not persisted.

Clients send `Authorization: Bearer <token>`. The SSE stream also accepts the
token as a `?token=` query parameter because the browser `EventSource` API cannot
set headers; the tradeoff is that a query-string token can leak into logs, which
is accepted for a local stream today and a future private-tailnet stream.
The token is compared in constant time over fixed-length digests, and a missing or wrong token returns `401`.

CORS origin policy stays local/Tauri-only plus at most one operator-configured exact origin (`corsOrigin`): the token check runs after the CORS middleware, so preflight `OPTIONS` still succeeds.
The `POST /webhooks/cursor` route is the one bearer exemption, because it is reached by Cursor's cloud and authenticates with its own HMAC signature instead (ADR-0022).
The bundled `aspex hook-relay` and `aspex preview list` present the token and dial the configured bind address so same-box ingestion still works when the Hub binds a specific interface.

## Trusted and Untrusted Inputs

Trusted enough to parse, not trusted to execute:

- GitHub API responses.
- Claude Code hook JSON forwarded by `aspex hook-relay`.
- Codex notify JSON forwarded by `aspex hook-relay`.
- OpenCode local `/event` SSE events.
- Cursor `statusChange` webhook JSON when explicitly enabled.
- Local webhook JSON.
- Giles home files (`data/backlog.md`, `state/<id>.meta`, the status log) and
  `bin/giles-worker-state.sh` output when the Giles orchestrator is enabled.
- Mock/demo event fixtures.
- Adapter evidence text and URLs.

URLs are displayed as links or deep-links. They are not script execution
surfaces. Adapter authors should prefer source-owned URLs such as GitHub PR
links and terminal/session deep-links.

## Actions

Actions are explicit adapter operations with risk metadata:

- `safe`: one-click where the adapter action is reversible or low impact.
- `medium`: visible as higher risk and reserved for adapter-specific use.
- `dangerous`: requires confirmation before dispatch.

The GitHub adapter is two-way because it uses official GitHub API calls. The
Claude Code adapter is read-only in Phase 0; blocked sessions expose a
deep-link/focus affordance, not PTY input or command injection.

## Liveness

The cockpit must not look current when it is not. Polled sources use poll health
for liveness. Push sources use heartbeat freshness. Terminal states do not
decay. This follows ADR-0003.

## Voice (Phase 1) and the HL2 lab

Voice is opt-in and the supported product surface is flat only.
The HoloLens 2 WebXR client is an unsupported lab instrument that reuses the
same Hub voice path; it does not make a headset product surface supported or
claim that the physical microphone gate has passed.

The web client captures audio only while Push-to-talk is held. There is no open
mic and no wake word. Each press creates one Utterance and sends browser
`MediaRecorder` audio plus Voice context to the configured Hub.

Audio and transcripts are data, never code. The Hub uses transcript text only as
a server-side Command grammar lookup or as a literal body in Dictation mode. It
does not `eval`, import, execute, or shell out with transcript text.

The safe-grammar rules live server-side in the Voice gateway. The client cannot
trigger or confirm an action by itself. No-match never acts. Actions marked
`requiresConfirmation` arm first and require a separate Confirm-phrase. Dictated
free text is accepted only after a dictation command, is read back, and is
posted only after `post it` or `send it`.

Every stateful voice or typed-intent request carries a filename-safe client
session id and a strictly increasing generation.
The Hub isolates pending state by session, replays an exact retry, and rejects
an older generation as cancelled without state advancement.
This prevents a delayed or retried request from confirming or dictating through
another client session.

Voice service traffic is local-first. The Hub binds loopback by default; when
real STT/TTS are enabled it calls configured local or tailnet HTTP services
outbound. The reference service exposes `/transcribe` and `/speak` and is meant
for a trusted localhost or tailnet/LAN address, not public ingress.

There is no telemetry or cloud STT/TTS by default. Web Speech is not part of the
shipped Phase 1 path. Real Parakeet/Piper services require explicit
configuration, and mock mode loads no model dependencies.

Audio handling is transient in the shipped path. Utterance audio is forwarded to
STT and not persisted by the Hub. TTS read-back audio, when present, is cached in
memory behind `/voice/audio/:id` for about one minute with Cache-Control
no-store semantics. Text read-back and Voice session state are returned to the
client so the UI can show status and pending confirmation/dictation.

## Preview Deck (Phase 2)

Preview Deck is opt-in and off by default. When disabled, the Hub does not mount
Preview routes and the Phase 0/1 world-model is unchanged.

The Deck boots declared Preview specs only. Specs come from local `~/.aspex`
configuration in v1; Aspex never builds images, checks out branches, computes
commands, or infers what to run. Pulling a declared image is allowed; building
is not. This is the ADR-0014 boundary that keeps the feature on the
consume-not-orchestrate side.

A Preview is ephemeral and never world-model state. It is not an Item, does not
enter needs-me, is not ranked, and is not persisted as attention state. Booting
is always an explicit user action, following ADR-0015.

v1 ships only the trusted-iframe Trust lane. Trusted specs render at their own
`http://127.0.0.1:<allocated-port>` origin inside:

```html
sandbox="allow-scripts allow-forms allow-same-origin"
referrerpolicy="no-referrer"
allow=""
```

The iframe deliberately withholds `allow-top-navigation`, `allow-popups`, and
`allow-modals`. Same-Origin Policy is the primary isolation boundary because the
Preview runs on a different localhost port from the cockpit. No Hub cookies,
tokens, GitHub credentials, database handles, voice credentials, or other Hub
secrets are sent into the Preview. The untrusted pixels lane is not shipped; an
`untrusted` spec is registered but refused at boot with a clear `403`.

Preview lifecycle is bounded and disposable. The broker enforces
`maxConcurrent`, passes CPU and memory limits to the engine, applies idle TTL,
and reaps Previews on explicit close, TTL expiry, and Hub shutdown. The Docker
engine uses recognizable `aspex-preview-*` names, `--rm`, and a startup sweep to
remove leftovers after a crash. Unexpected exit is surfaced as `crashed` with a
message and is not auto-restarted.

The Hub binds loopback by default. Docker is opt-in and capability-detected; if
the configured engine is unavailable, Preview routes are disabled with an
honest warning and the Hub continues to run. CI and broker tests use the mock
engine and require no Docker.

## Free-Form Intent (Phase 3)

Free-form intent is opt-in and default off. The closed Phase 1 grammar runs
first, and the local Intent service is called only when the grammar returns
`no_match` with reason `unknown_command`. Other no-match reasons do not reach
the model.

The Intent service is a prompt-injection surface because it receives untrusted
Item summaries, which can contain agent-authored titles and details, while
resolving referents. The defense is structural, following ADR-0019 and
ADR-0020: the model output is an enum-constrained `Intent` built from the live
Voice context. Item ids and action ids are schema enums. The model cannot invent
ids, create actions, emit shell commands, or escape the first-stage Intent
union.

The schema permits first-stage Intents only: navigation, read, open, action,
dictate, or `no_match`. It does not permit `confirm`, `dictation_body`, `post`,
or `cancel`. Free-form is single-shot and never orchestrates compound,
conditional, or scheduled work.

Dangerous actions still need the normal separate confirm phrase. In the shipped
default, any free-form-originated action also elevates confirmation, even if the
underlying adapter action is normally safe. The readback is honest about the
interpretation before the user confirms.

The real Intent service calls local Ollama over `/api/chat` with a per-request
JSON Schema in `format`. There is no cloud LLM and no telemetry. CI and local
smoke tests can use `ASPEX_INTENT_MOCK=1`, which loads no model and needs no
GPU.

## Cursor Cloud Webhook (Phase 3)

Cursor ingestion is the one Phase 3 cloud-origin inbound surface, and it is a
bounded exception under ADR-0022. It is opt-in, default off, and observe-only.
The Hub mounts `POST /webhooks/cursor` only when the cursor adapter is enabled.

The route is signature-verified with the configured shared secret and fails
closed without a secret. Unsigned or invalid payloads are rejected before they
become Signals.

Aspex never auto-exposes this endpoint. The Hub binds loopback by default. If a
Cursor cloud agent can reach the route, that is the user's deliberate ingress
choice, for example through their own Tailscale Funnel or equivalent tunnel.
Aspex does not manage a public-webhook or Funnel subsystem in Phase 3.

Cursor payloads become agent-local Items such as `cursor:agent:<id>` with
deep-links. They do not dispatch control actions and do not own PR-lifecycle
attention.

## Orchestrator Direction Channel

The Giles orchestrator is opt-in and default off (`orchestrators.giles.enabled`
or `ASPEX_GILES_ENABLED`). When disabled, no orchestrator routes dispatch
anything and the Giles home is never read.

Ingestion is read-only: the adapter polls the Giles home (backlog, task meta,
`bin/giles-worker-state.sh`) and treats everything it reads as data, never
code. The one place the adapter writes is the designated `state/aspex-inbox/`
delivery directory, using atomic write-then-rename; Aspex never mutates a
project or any other path in the Giles home.

Direction is queue-only: an intent file is a request for Giles to execute the
verb through its own sanctioned helpers, so Giles remains the enforcement
point for what actually runs. Consequential verbs require the same
confirmation gates as other actions: `requiresConfirmation` item actions and
`dispatch` on `POST /intents` are refused with `409` until confirmed.

Idempotency is the double-execution defense. Every intent carries a
client-generated `intentId` restricted to a filename-safe alphabet
(no separators, no leading dot, bounded length) so it cannot express path
tricks when reused as the inbox filename. The Hub's bounded `IntentLedger`
replays the cached ack for a retried intent, and the inbox filename is the
durable backstop, so a retried ship cannot double-merge and a retried dispatch
cannot spawn a second worker. Failures are not cached, so transient errors
stay retryable.

## Future Labs Isolation

The HL2 lab is deliberately isolated from product clients and remains without
physical-device verification; spatial product panels, delegation depth, and the
untrusted Preview pixels lane remain future Labs work.
Preview Deck's shipped Phase 2 security boundary is described above and in
`docs/preview-deck.md`; the forward plan for later spatial and arbitrary-app
surfaces remains in `docs/build/90-later-phases-outline.md`.
