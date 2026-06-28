# Event Schema

Aspex models the world as current-state `AttentionItem` records. A raw inbound
observation is a `Signal`; the Hub applies it by stable id and upserts the
matching Item.

The canonical TypeScript package is `packages/schema`.

## Sources

```ts
export type Source =
  | "github"
  | "claude-code"
  | "codex"
  | "webhook"
  | "ntfy"
  | "mcp";
```

Phase 0 implements GitHub, Claude Code, mock, webhook, and ntfy behavior. Codex
and MCP are schema-level provisions for later adapters.

## Stable Item Ids

Each real-world object has exactly one Item. Conditions do not create extra
Items.

Examples:

- `github:pr:owner/repo#42`
- `claude-code:session:<uuid>`
- `webhook:<key>`

Helpers in `packages/schema/src/ids.ts` create common ids:

```ts
githubPrId(repo, number);
claudeSessionId(sessionId);
webhookId(key);
parseItemId(id);
```

## AttentionItem

```ts
export type ItemId = string;

export type State = "working" | "blocked" | "needs_review" | "done" | "error";
export type Liveness = "live" | "quiet" | "stale" | "lost";
export type Severity = "info" | "low" | "medium" | "high";
export type Risk = "safe" | "medium" | "dangerous";

export type Reason =
  | "blocked_on_human"
  | "failing_ci"
  | "review_requested"
  | "awaiting_merge"
  | "errored"
  | "ambient";

export interface Action {
  id: string;
  label: string;
  risk: Risk;
  requiresConfirmation: boolean;
}

export interface Evidence {
  label: string;
  url?: string;
  text?: string;
}

export interface AttentionItem {
  id: ItemId;
  source: Source;
  project: string;
  session?: string;
  actor?: string;
  state: State;
  liveness: Liveness;
  reason: Reason;
  attentionRequired: boolean;
  severity: Severity;
  summary: string;
  evidence: Evidence[];
  actions: Action[];
  deepLink?: string;
  observedAt: string;
  staleAfter: string;
}
```

## Signal

```ts
export type Signal = Partial<AttentionItem> &
  Pick<AttentionItem, "id" | "source" | "state">;
```

A Signal must include `id`, `source`, and `state`. The Hub fills or preserves
derived fields such as reason, liveness defaults, timestamps, and retained
actions/evidence when a partial Signal omits them.

Signals are transient. They may be discarded after they update the world-model.

## State

- `working`: source reports active work.
- `blocked`: source reports waiting on a human or external unblock.
- `needs_review`: source reports review/approval is needed.
- `done`: source reports completed work.
- `error`: source reports a terminal or high-priority failure.

State is source-reported. It is separate from `reason`, which ranks the Item.

## Reason and Priority Ladder

Each Item has exactly one Reason at a time: the highest-priority condition that
explains why it appears where it appears.

| Rung | Reason | Meaning | Needs-me |
| --- | --- | --- | --- |
| 1 | `blocked_on_human` | Agent or source is waiting on the user | yes |
| 2 | `failing_ci` | A relevant PR has failing checks | yes |
| 3 | `review_requested` | A relevant PR needs review | yes |
| 4 | `awaiting_merge` | Work is ready for merge/confirmation | yes |
| 5 | `ambient` | Working or informational state | no |

`errored` is ranked in the top band with severity-aware ordering.

Within a rung, Items sort by severity descending, then `observedAt` descending.
The needs-me list is capped by Hub config.

## Liveness

`liveness` describes how much the Hub trusts the reported state:

- `live`
- `quiet`
- `stale`
- `lost`

Polled sources, such as GitHub, use poll health. Push sources, such as Claude
Code hooks, use heartbeat freshness. Terminal states do not decay. See
ADR-0003.

## Actions and Deep-Links

Actions are adapter-owned operations. Each action declares its risk and whether
confirmation is required. Dangerous actions must be confirmed before dispatch.

Deep-links are read-only affordances. Use them when Aspex can show where the
Item lives but cannot safely act on it. Claude Code uses deep-links only in
Phase 0.

## Voice Contract

The canonical Phase 1 voice types live in `packages/schema/src/voice.ts`.
`VoiceTranscript` in prose refers to the `Transcript` type below.

```ts
export interface VoiceContext {
  selectedId?: ItemId;
  needsMeIds: ItemId[];
}

export interface Transcript {
  text: string;
  confidence: number;
}

export type Intent =
  | { kind: "nav"; directive: ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "action"; itemId: ItemId; actionId: string }
  | { kind: "confirm"; itemId: ItemId; actionId: string }
  | { kind: "dictate"; itemId: ItemId; actionId: string }
  | { kind: "dictation_body"; text: string }
  | { kind: "post" }
  | { kind: "cancel" }
  | { kind: "no_match"; heard: string; reason: NoMatchReason };

export type NoMatchReason =
  | "low_confidence"
  | "unknown_command"
  | "no_referent"
  | "action_unavailable"
  | "ambiguous";

export type ClientDirective =
  | { type: "select"; id: ItemId }
  | { type: "move"; delta: 1 | -1 }
  | { type: "show_needs_me" }
  | { type: "none" };

export interface VoiceSession {
  pendingConfirm?: {
    itemId: ItemId;
    actionId: string;
    label: string;
    armedAt: string;
  };
  dictating?: {
    itemId: ItemId;
    actionId: string;
    pendingBody?: string;
  };
}

export interface VoiceResult {
  ok: boolean;
  readback: string;
  audioUrl?: string;
  directive?: ClientDirective;
  session: VoiceSession;
}
```

`VoiceContext` is attached by the client to every Utterance. `selectedId` is the
current client selection, if any. `needsMeIds` is the ordered needs-me list the
client is showing.

`Transcript` is returned by the STT service contract. `confidence` is a numeric
`0..1` score used by the Hub confidence gate.

`Intent` is an internal parser result. It is documented so the grammar contract
is reviewable, but clients do not send intents.

`ClientDirective` is an optional UI effect returned by the Hub. `select` focuses
an Item, `move` changes selection by one row in the needs-me list,
`show_needs_me` tells the client to show the needs-me view, and `none` is a
no-op directive.

`VoiceSession` is mirrored in responses so the client can display pending
confirmation or Dictation mode. `pendingBody` is present after the Hub has read
back a dictated body and before `post it`/`send it`.

`VoiceResult.ok` is false for no-match and gateway error read-backs. `readback`
is always present. `audioUrl` is present only when TTS produced cached WAV bytes.

## `/voice/utterance`

`POST /voice/utterance` accepts `multipart/form-data`:

| Field | Required | Meaning |
| --- | --- | --- |
| `audio` | yes | File-like browser audio blob, usually `audio/webm` or `audio/wav`. |
| `context` | yes | JSON-encoded `VoiceContext`. |

The Hub returns `503 { "error": "voice not configured" }` when voice is disabled
or no Voice gateway is configured. Missing audio, missing context, malformed
context JSON, or invalid `VoiceContext` return HTTP 400 with a `message`.

On a valid request the HTTP route calls the Voice gateway and returns
`VoiceResult` JSON. Gateway no-match cases still return HTTP 200 with
`ok: false`; they are not request validation failures.

The gateway may produce raw TTS bytes internally. The HTTP route strips any
gateway-supplied `audioUrl`, caches raw audio bytes in memory, and adds
`audioUrl: "/voice/audio/<id>"` only for that cache entry.

`GET /voice/audio/:id` returns cached `audio/wav` bytes with
`Cache-Control: no-store`, or 404 when the id is missing or expired.

`GET /voice/health` returns whether the Voice gateway is configured and the
configured STT/TTS mode. `GET /voice/config` returns the client-facing
`enabled` flag and `pttKey`.
