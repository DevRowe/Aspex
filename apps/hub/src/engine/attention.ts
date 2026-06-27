import type { AttentionItem, Reason, Severity, State } from "@aspex/schema";

// Lower number = higher priority (top of needs-me).
export const RUNG: Record<Reason, number> = {
  blocked_on_human: 1,
  errored: 1,
  failing_ci: 2,
  review_requested: 3,
  awaiting_merge: 4,
  ambient: 99,
};

const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const GITHUB_ATTENTION_REASONS = new Set<Reason>([
  "failing_ci",
  "review_requested",
  "awaiting_merge",
]);

const WEBHOOK_ATTENTION_REASON_BY_STATE: Partial<Record<State, Reason>> = {
  blocked: "blocked_on_human",
  needs_review: "review_requested",
  done: "awaiting_merge",
  error: "errored",
};

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

// ADR-0002 guard. Adapters set reason/attentionRequired; this clamps them so the
// ownership rule holds even if an adapter misbehaves.
export function enforceOwnership(item: AttentionItem): AttentionItem {
  if (item.source === "claude-code" || item.source === "codex") {
    if (item.state === "blocked") {
      return {
        ...item,
        attentionRequired: true,
        reason: "blocked_on_human",
      };
    }

    if (item.state === "error") {
      return {
        ...item,
        attentionRequired: true,
        reason: "blocked_on_human",
        severity: "high",
      };
    }

    return {
      ...item,
      attentionRequired: false,
      reason: "ambient",
    };
  }

  if (
    item.source === "github" &&
    item.attentionRequired &&
    GITHUB_ATTENTION_REASONS.has(item.reason)
  ) {
    return { ...item };
  }

  if (item.source === "webhook" && item.attentionRequired) {
    const reason =
      item.reason === "ambient"
        ? WEBHOOK_ATTENTION_REASON_BY_STATE[item.state]
        : item.reason;

    if (reason !== undefined && reason !== "ambient") {
      return {
        ...item,
        reason,
      };
    }
  }

  return {
    ...item,
    attentionRequired: false,
    reason: "ambient",
  };
}

export interface RankedView {
  needsMe: AttentionItem[];
  overflow: AttentionItem[];
  ambient: AttentionItem[];
}

export function rank(items: AttentionItem[], cap: number): RankedView {
  const sortedAttention = items
    .filter((item) => item.attentionRequired && item.reason !== "ambient")
    .toSorted(compareAttentionItems);

  return {
    needsMe: sortedAttention.slice(0, cap),
    overflow: sortedAttention.slice(cap),
    ambient: items
      .filter((item) => !item.attentionRequired || item.reason === "ambient")
      .toSorted(compareObservedAtDesc),
  };
}

function compareAttentionItems(
  left: AttentionItem,
  right: AttentionItem,
): number {
  return (
    RUNG[left.reason] - RUNG[right.reason] ||
    severityRank(right.severity) - severityRank(left.severity) ||
    Date.parse(right.observedAt) - Date.parse(left.observedAt)
  );
}

function compareObservedAtDesc(
  left: AttentionItem,
  right: AttentionItem,
): number {
  return Date.parse(right.observedAt) - Date.parse(left.observedAt);
}
