# Adapter Authoring

Adapters ingest Signals for one Source and optionally dispatch Actions back to
that Source. New adapters should fit the existing `packages/schema` interface
without changing the Hub engine.

## Interface

```ts
export interface Adapter {
  id: string;
  start(ctx: AdapterContext): Promise<void>;
  listActions(itemId: string): Action[];
  runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult>;
  stop(): Promise<void>;
}

export interface AdapterContext {
  emit(signal: Signal): void;
  heartbeat(source: string): void;
  log(msg: string): void;
}
```

`start` begins polling, hook handling, or subscriptions. `stop` releases timers
and resources. `emit` sends a Signal to the Hub. `heartbeat` refreshes liveness
without changing state. `listActions` and `runAction` expose only actions owned
by the adapter.

## Id Scheme

Every Item id must be stable and source-derived. Use one Item per real-world
object, not one Item per condition.

Use these patterns unless an ADR introduces a better source-specific shape:

- GitHub PR: `github:pr:<owner>/<repo>#<number>`
- Claude Code session: `claude-code:session:<uuid>`
- Codex session: `codex:session:<id>`
- OpenCode session: `opencode:session:<id>`
- Cursor agent: `cursor:agent:<id>`
- Webhook item: `webhook:<key>`

Prefer helpers from `packages/schema/src/ids.ts`.

## Attention Ownership

Follow ADR-0002: one unit of work never glows twice.

- Per-agent adapters own in-flight attention: `blocked` and `error`.
- The GitHub adapter owns PR-lifecycle attention: failing CI, review requested,
  and awaiting merge.
- A completed agent session is Ambient unless another owning adapter raises
  attention for the next lifecycle stage.

Do not make a per-agent adapter raise needs-me for a completed session just
because the work may have produced a PR. The GitHub adapter owns that stage.

## Liveness

Follow ADR-0003.

Polled adapters should call `ctx.heartbeat(source)` after a successful poll
cycle. If polling fails, is rate-limited, or cannot reach the source, do not
heartbeat; let Items decay honestly.

Push adapters should heartbeat when they have fresh proof the source is still
alive. Claude Code synthesizes this from `PostToolUse` hook traffic. A heartbeat
must not overwrite a blocked or done state with `working`.

Terminal states do not decay.

## Actions and Deep-Links

Expose actions only when there is a safe official mechanism for them. Each
action must include:

- stable `id`
- user-facing `label`
- `risk`: `safe`, `medium`, or `dangerous`
- `requiresConfirmation`

Dangerous actions require confirmation at the HTTP layer before dispatch.

When no safe action path exists, provide a `deepLink` instead. Claude Code is
read-only in Phase 0 by ADR-0004, so it returns no actions and points the user
back to their terminal/session.

Codex, opencode, and cursor are observe-only in Phase 3 by ADR-0021 and
ADR-0022. They must expose no control actions. `listActions` returns `[]`, and
`runAction` must reject any attempted action. Use deep-links or source-local
instructions to send the user back to the relevant agent UI.

## Phase 3 Ingestion Patterns

### Notify Relay

Use this for CLI tools that can run a local notification command when session
or turn events are available. Codex follows this pattern.

The tool calls `aspex hook-relay --source codex ...`, and the relay posts to the
local Hub. The current Codex notify payload maps completed turns to
`done`/`ambient` Items. Keep the relay data-only: translate the notification
payload into a Signal, attach evidence and a deep-link when available, and never
execute agent-authored text.

### Local SSE Subscription

Use this for tools that expose a local event stream. OpenCode follows this
pattern by subscribing to `opencode serve` `/event`.

The adapter should treat stream events as observations, emit Signals for
session state, and heartbeat only while the stream is fresh. If the stream
disconnects or the local server is unavailable, do not synthesize healthy
liveness.

### Signed Webhook Ingestion

Use this only when the source cannot provide a local poll or hook path. Cursor
follows this pattern for `statusChange` webhooks.

Webhook adapters must be opt-in, default off, and signature-verified. They must
fail closed when the secret is absent or the signature is invalid. Do not expose
the Hub publicly from adapter code. The Hub binds `127.0.0.1`; any tunnel or
Funnel that lets a cloud webhook reach it is a deliberate user deployment
choice.

Signed cloud-origin webhooks should emit observe-only Signals and deep-links.
They must not imply that Aspex can control the cloud agent.

## Webhook Contract

The local webhook path is:

```txt
POST http://127.0.0.1:4317/signals/webhook
content-type: application/json
```

Accepted body:

```ts
interface WebhookBody {
  key?: string;
  id?: string; // must already start with "webhook:" if used
  summary: string;
  state?: "working" | "blocked" | "needs_review" | "done" | "error";
  severity?: "info" | "low" | "medium" | "high";
  attentionRequired?: boolean;
  project?: string;
  evidence?: Array<{ label: string; url?: string; text?: string }>;
}
```

Normalization rules:

- `key` becomes `id = webhook:<key>`.
- If `id` is supplied instead, it must be a valid `webhook:` id.
- `summary` is required.
- `project` defaults to `webhook`.
- `attentionRequired` defaults to `false`.
- `state` defaults to `needs_review` when attention is required, otherwise
  `working`.
- `severity` defaults to `info`.
- Actions are always `[]` for generic webhooks in Phase 0.

Example:

```sh
curl -X POST http://127.0.0.1:4317/signals/webhook \
  -H 'content-type: application/json' \
  -d '{"key":"deploy-1","summary":"Deploy failed","state":"error","severity":"high","attentionRequired":true}'
```

## References

- [ADR-0001: World-model is current-state Items](adr/0001-world-model-is-upserted-items-not-events.md)
- [ADR-0002: Attention is partitioned by lifecycle stage](adr/0002-attention-partitioned-by-lifecycle-stage.md)
- [ADR-0003: Two-track liveness](adr/0003-two-track-liveness-poll-health-vs-heartbeats.md)
- [ADR-0004: Phase 0 Claude Code is read-only](adr/0004-phase0-claude-code-is-read-only.md)
- [ADR-0021: Phase 3 agent adapters are observe-only](adr/0021-phase3-agent-adapters-are-observe-only-and-own-agent-local-attention.md)
- [ADR-0022: Cursor webhook bounded exception](adr/0022-cursor-webhook-bounded-exception.md)
- [Event schema](event-schema.md)
