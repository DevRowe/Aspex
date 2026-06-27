import type { Action, Reason, Signal, State } from "@aspex/schema";

export type GithubPrMatch =
  | "review_requested"
  | "author"
  | "assignee"
  | "allowlist";

export interface GithubCheckSummary {
  failing: string[];
  total: number;
  green: boolean;
  url?: string;
}

export interface GithubRawPullRequest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  headSha: string;
  mergeable: boolean | null;
  matches: GithubPrMatch[];
  checks: GithubCheckSummary;
  approved: boolean;
  observedAt?: string;
}

interface Classification {
  reason: Reason;
  state: State;
  severity: Signal["severity"];
  attentionRequired: boolean;
  actions: Action[];
}

const REVIEW_ACTIONS: Action[] = [
  {
    id: "approve",
    label: "Approve",
    risk: "medium",
    requiresConfirmation: true,
  },
  {
    id: "comment",
    label: "Comment",
    risk: "safe",
    requiresConfirmation: false,
  },
];

const RERUN_ACTION: Action = {
  id: "rerun",
  label: "Re-run checks",
  risk: "medium",
  requiresConfirmation: true,
};

const MERGE_ACTION: Action = {
  id: "merge",
  label: "Merge",
  risk: "dangerous",
  requiresConfirmation: true,
};

export function githubItemId(
  pr: Pick<GithubRawPullRequest, "owner" | "repo" | "number">,
): string {
  return `github:pr:${pr.owner}/${pr.repo}#${pr.number}`;
}

export function mapGithubPullRequest(
  pr: GithubRawPullRequest,
  now = new Date(),
): Signal {
  const observedAt = pr.observedAt ?? now.toISOString();
  const classified = classify(pr);

  return {
    id: githubItemId(pr),
    source: "github",
    project: `${pr.owner}/${pr.repo}`,
    actor: pr.author,
    state: classified.state,
    liveness: "live",
    reason: classified.reason,
    attentionRequired: classified.attentionRequired,
    severity: classified.severity,
    summary: summaryFor(pr, classified.reason),
    evidence: evidenceFor(pr),
    actions: classified.actions,
    deepLink: pr.url,
    observedAt,
    staleAfter: new Date(observedAt).toISOString(),
  };
}

function classify(pr: GithubRawPullRequest): Classification {
  const actions: Action[] = [];
  const needsReview =
    pr.matches.includes("review_requested") || pr.matches.includes("assignee");
  const readyToMerge = pr.checks.green && pr.approved && pr.mergeable === true;

  if (needsReview) {
    actions.push(...REVIEW_ACTIONS);
  }

  if (readyToMerge) {
    actions.push(MERGE_ACTION);
  }

  if (pr.checks.failing.length > 0) {
    actions.push(RERUN_ACTION);

    return {
      reason: "failing_ci",
      state: "needs_review",
      severity: "high",
      attentionRequired: true,
      actions: uniqueActions(actions),
    };
  }

  if (needsReview) {
    return {
      reason: "review_requested",
      state: "needs_review",
      severity: "medium",
      attentionRequired: true,
      actions: uniqueActions(actions),
    };
  }

  if (readyToMerge) {
    return {
      reason: "awaiting_merge",
      state: "needs_review",
      severity: "medium",
      attentionRequired: true,
      actions: uniqueActions(actions),
    };
  }

  return {
    reason: "ambient",
    state: "working",
    severity: "info",
    attentionRequired: false,
    actions: [],
  };
}

function evidenceFor(pr: GithubRawPullRequest): Signal["evidence"] {
  const evidence: NonNullable<Signal["evidence"]> = [
    {
      label: "Pull request",
      url: pr.url,
      text: `${pr.owner}/${pr.repo}#${pr.number}`,
    },
  ];

  if (pr.matches.length > 0) {
    evidence.push({
      label: "Matched queries",
      text: uniqueStrings(pr.matches).join(", "),
    });
  }

  if (pr.checks.failing.length > 0) {
    evidence.push({
      label: "Failing checks",
      url: pr.checks.url,
      text: pr.checks.failing.join(", "),
    });
  }

  return evidence;
}

function summaryFor(pr: GithubRawPullRequest, reason: Reason): string {
  const prefix = `#${pr.number} ${pr.title}`;

  if (reason === "failing_ci") {
    const count = pr.checks.failing.length;
    const noun = count === 1 ? "check" : "checks";

    return `${prefix} - CI failing on ${count} ${noun}`;
  }

  if (reason === "review_requested") {
    return `${prefix} - review requested`;
  }

  if (reason === "awaiting_merge") {
    return `${prefix} - approved and ready to merge`;
  }

  return `${prefix} - open pull request`;
}

function uniqueActions(actions: Action[]): Action[] {
  const byId = new Map<string, Action>();

  for (const action of actions) {
    byId.set(action.id, action);
  }

  return [...byId.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
