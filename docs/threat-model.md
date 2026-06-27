# Threat Model

This document describes the Phase 0 security stance as shipped. It is scoped to
the local Hub, web cockpit, desktop shell, and Phase 0 adapters.

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

Summaries and evidence are deterministic templates in Phase 0. There is no LLM
summarization path in the shipped core.

## Local-Only Boundary

The Hub binds `127.0.0.1` and is intended for same-machine access only. There is
no public ingress in Phase 0.

The desktop shell and web client talk to the local Hub over REST and SSE. The
Hub stores state locally in SQLite. A GitHub token, when configured, stays local
in config or environment variables and is used only by the GitHub adapter.

The webhook adapter is also local ingest. It accepts data for the local Hub; it
does not make generic webhook actions writable in Phase 0.

## Trusted and Untrusted Inputs

Trusted enough to parse, not trusted to execute:

- GitHub API responses.
- Claude Code hook JSON forwarded by `aspex hook-relay`.
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

## Future Labs Isolation

Voice, spatial panels, preview decks, and delegation depth are future Labs work,
not Phase 0 features. The forward plan is described in
`docs/build/90-later-phases-outline.md`.

Future preview work must keep agent code out of the cockpit origin. Expected
directions are origin/process isolation, cross-origin or process-isolated
previews, postMessage-style contracts, and pixels-not-code rendering for
arbitrary agent-produced apps. These mechanisms are not part of the Phase 0
shipped core.
