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
