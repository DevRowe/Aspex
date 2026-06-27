import { describe, expect, test } from "bun:test";
import type { AttentionItem } from "@aspex/schema";
import {
  RUNG,
  enforceOwnership,
  rank,
  severityRank,
} from "../src/engine/attention";

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "github:pr:owner/repo#42",
    source: "github",
    project: "owner/repo",
    state: "needs_review",
    liveness: "live",
    reason: "review_requested",
    attentionRequired: true,
    severity: "medium",
    summary: "Review requested on owner/repo#42",
    evidence: [],
    actions: [],
    observedAt: "2026-06-28T00:00:00.000Z",
    staleAfter: "2026-06-28T00:05:00.000Z",
    ...overrides,
  };
}

describe("attention ownership", () => {
  test("github PR with failing CI and review action remains one higher-rung item", () => {
    const source = item({
      reason: "failing_ci",
      actions: [
        {
          id: "review",
          label: "Review PR",
          risk: "safe",
          requiresConfirmation: false,
        },
        {
          id: "rerun-ci",
          label: "Re-run CI",
          risk: "safe",
          requiresConfirmation: false,
        },
      ],
    });

    const enforced = enforceOwnership(source);
    const view = rank([enforced], 7);

    expect(enforced).not.toBe(source);
    expect(enforced).toMatchObject({
      id: "github:pr:owner/repo#42",
      reason: "failing_ci",
      attentionRequired: true,
    });
    expect(RUNG[enforced.reason]).toBe(2);
    expect(enforced.actions.map((action) => action.id)).toEqual([
      "review",
      "rerun-ci",
    ]);
    expect(view.needsMe).toEqual([enforced]);
    expect(view.overflow).toEqual([]);
  });

  test("claude-code done is ambient and never needs-me", () => {
    const source = item({
      id: "claude-code:session:abc",
      source: "claude-code",
      project: "aspex",
      state: "done",
      reason: "awaiting_merge",
      attentionRequired: true,
    });

    const enforced = enforceOwnership(source);
    const view = rank([enforced], 7);

    expect(enforced).not.toBe(source);
    expect(source.attentionRequired).toBe(true);
    expect(source.reason).toBe("awaiting_merge");
    expect(enforced).toMatchObject({
      attentionRequired: false,
      reason: "ambient",
    });
    expect(view.needsMe).toEqual([]);
    expect(view.ambient).toEqual([enforced]);
  });

  test("claude-code blocked is rung 1 and top of needs-me", () => {
    const blocked = enforceOwnership(
      item({
        id: "claude-code:session:blocked",
        source: "claude-code",
        project: "aspex",
        state: "blocked",
        reason: "ambient",
        attentionRequired: false,
        severity: "medium",
        observedAt: "2026-06-28T00:00:00.000Z",
      }),
    );
    const githubFailure = enforceOwnership(
      item({
        id: "github:pr:owner/repo#42",
        reason: "failing_ci",
        severity: "high",
        observedAt: "2026-06-28T00:01:00.000Z",
      }),
    );

    const view = rank([githubFailure, blocked], 7);

    expect(blocked).toMatchObject({
      reason: "blocked_on_human",
      attentionRequired: true,
    });
    expect(RUNG[blocked.reason]).toBe(1);
    expect(view.needsMe).toEqual([blocked, githubFailure]);
  });

  test("claude-code error is clamped into the top band with high severity", () => {
    const errored = enforceOwnership(
      item({
        id: "claude-code:session:error",
        source: "claude-code",
        project: "aspex",
        state: "error",
        reason: "ambient",
        attentionRequired: false,
        severity: "low",
      }),
    );

    expect(errored).toMatchObject({
      reason: "blocked_on_human",
      attentionRequired: true,
      severity: "high",
    });
  });

  test("webhook attention with no reason derives an existing needs-me reason", () => {
    const source = item({
      id: "webhook:deploy-1",
      source: "webhook",
      project: "aspex",
      state: "error",
      reason: "ambient",
      attentionRequired: true,
      severity: "high",
      summary: "Deploy failed",
    });

    const enforced = enforceOwnership(source);
    const view = rank([enforced], 7);

    expect(enforced).not.toBe(source);
    expect(enforced).toMatchObject({
      reason: "errored",
      attentionRequired: true,
      severity: "high",
    });
    expect(RUNG[enforced.reason]).toBe(1);
    expect(view.needsMe).toEqual([enforced]);
    expect(view.ambient).toEqual([]);
  });

  test("webhook attention with default needs-review state can land in needs-me", () => {
    const enforced = enforceOwnership(
      item({
        id: "webhook:manual-check",
        source: "webhook",
        project: "aspex",
        state: "needs_review",
        reason: "ambient",
        attentionRequired: true,
        severity: "medium",
      }),
    );

    const view = rank([enforced], 7);

    expect(enforced).toMatchObject({
      reason: "review_requested",
      attentionRequired: true,
    });
    expect(view.needsMe).toEqual([enforced]);
  });

  test("invalid github attention is normalized to ambient", () => {
    const enforced = enforceOwnership(
      item({
        state: "working",
        reason: "blocked_on_human",
        attentionRequired: true,
      }),
    );

    expect(enforced).toMatchObject({
      reason: "ambient",
      attentionRequired: false,
    });
  });
});

describe("rank", () => {
  test("errored reason is in the top attention band", () => {
    expect(RUNG.errored).toBe(1);
  });

  test("cap splits needs-me and overflow", () => {
    const items = [
      item({ id: "github:pr:owner/repo#1", reason: "failing_ci" }),
      item({ id: "github:pr:owner/repo#2", reason: "review_requested" }),
      item({ id: "github:pr:owner/repo#3", reason: "awaiting_merge" }),
      item({
        id: "claude-code:session:blocked",
        source: "claude-code",
        state: "blocked",
        reason: "blocked_on_human",
      }),
    ];

    const view = rank(items, 2);

    expect(view.needsMe).toHaveLength(2);
    expect(view.overflow).toHaveLength(2);
    expect(view.needsMe.map((rankedItem) => rankedItem.id)).toEqual([
      "claude-code:session:blocked",
      "github:pr:owner/repo#1",
    ]);
  });

  test("rung-3 tie breaks by severity then recency", () => {
    const olderHigh = item({
      id: "github:pr:owner/repo#high-old",
      reason: "review_requested",
      severity: "high",
      observedAt: "2026-06-28T00:00:00.000Z",
    });
    const newerHigh = item({
      id: "github:pr:owner/repo#high-new",
      reason: "review_requested",
      severity: "high",
      observedAt: "2026-06-28T00:02:00.000Z",
    });
    const newerMedium = item({
      id: "github:pr:owner/repo#medium-new",
      reason: "review_requested",
      severity: "medium",
      observedAt: "2026-06-28T00:03:00.000Z",
    });

    const view = rank([newerMedium, olderHigh, newerHigh], 7);

    expect(view.needsMe).toEqual([newerHigh, olderHigh, newerMedium]);
  });

  test("ambient sorts by recency and never appears in needs-me", () => {
    const olderAmbient = item({
      id: "codex:session:older",
      source: "codex",
      state: "working",
      reason: "ambient",
      attentionRequired: false,
      observedAt: "2026-06-28T00:00:00.000Z",
    });
    const newerAmbient = item({
      id: "codex:session:newer",
      source: "codex",
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      observedAt: "2026-06-28T00:01:00.000Z",
    });
    const invalidAmbient = item({
      id: "webhook:notice:1",
      source: "webhook",
      state: "working",
      reason: "ambient",
      attentionRequired: true,
      observedAt: "2026-06-28T00:02:00.000Z",
    });

    const view = rank([olderAmbient, invalidAmbient, newerAmbient], 7);

    expect(view.needsMe).toEqual([]);
    expect(view.overflow).toEqual([]);
    expect(view.ambient).toEqual([invalidAmbient, newerAmbient, olderAmbient]);
  });

  test("severityRank maps high to info in descending priority", () => {
    expect([
      severityRank("high"),
      severityRank("medium"),
      severityRank("low"),
      severityRank("info"),
    ]).toEqual([3, 2, 1, 0]);
  });
});
