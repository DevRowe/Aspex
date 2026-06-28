export type Source =
  | "github"
  | "claude-code"
  | "codex"
  | "opencode"
  | "cursor"
  | "webhook"
  | "ntfy"
  | "mcp";

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

export type Signal = Partial<AttentionItem> &
  Pick<AttentionItem, "id" | "source" | "state">;
