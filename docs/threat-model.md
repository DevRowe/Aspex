# Threat Model

This document describes the security stance as shipped through Phase 3. It is
scoped to the local Hub, web cockpit, desktop shell, Phase 0 adapters, and the
Phase 1 flat voice loop, the Phase 2 Preview Deck, and Phase 3 free-form intent
plus observe-only agent adapters.

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

The Hub binds `127.0.0.1` and is intended for same-machine access only. There is
no automatic public ingress.

The desktop shell and web client talk to the local Hub over REST and SSE. The
Hub stores state locally in SQLite. A GitHub token, when configured, stays local
in config or environment variables and is used only by the GitHub adapter.

The webhook adapter is also local ingest. It accepts data for the local Hub; it
does not make generic webhook actions writable in Phase 0.

## Trusted and Untrusted Inputs

Trusted enough to parse, not trusted to execute:

- GitHub API responses.
- Claude Code hook JSON forwarded by `aspex hook-relay`.
- Codex notify JSON forwarded by `aspex hook-relay`.
- OpenCode local `/event` SSE events.
- Cursor `statusChange` webhook JSON when explicitly enabled.
- Local webhook JSON.
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

## Voice (Phase 1)

Voice is opt-in and flat only. There is no Phase 1 headset, spatial, or WebXR
voice path.

The web client captures audio only while Push-to-talk is held. There is no open
mic and no wake word. Each press creates one Utterance and sends browser
`MediaRecorder` audio plus Voice context to the local Hub.

Audio and transcripts are data, never code. The Hub uses transcript text only as
a server-side Command grammar lookup or as a literal body in Dictation mode. It
does not `eval`, import, execute, or shell out with transcript text.

The safe-grammar rules live server-side in the Voice gateway. The client cannot
trigger or confirm an action by itself. No-match never acts. Actions marked
`requiresConfirmation` arm first and require a separate Confirm-phrase. Dictated
free text is accepted only after a dictation command, is read back, and is
posted only after `post it` or `send it`.

Voice service traffic is local-first. The Hub remains bound to `127.0.0.1`; when
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

The Hub remains `127.0.0.1` only. Docker is opt-in and capability-detected; if
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

Aspex never auto-exposes this endpoint. The Hub still binds `127.0.0.1`. If a
Cursor cloud agent can reach the route, that is the user's deliberate ingress
choice, for example through their own Tailscale Funnel or equivalent tunnel.
Aspex does not manage a public-webhook or Funnel subsystem in Phase 3.

Cursor payloads become agent-local Items such as `cursor:agent:<id>` with
deep-links. They do not dispatch control actions and do not own PR-lifecycle
attention.

## Future Labs Isolation

Spatial panels, delegation depth, WebXR voice entry checks, and the untrusted
Preview pixels lane remain future Labs work. Preview Deck's shipped Phase 2
security boundary is described above and in `docs/preview-deck.md`; the forward
plan for later spatial and arbitrary-app surfaces remains in
`docs/build/90-later-phases-outline.md`.
