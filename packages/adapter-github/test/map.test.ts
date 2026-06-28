import { describe, expect, test } from "bun:test";
import { type GithubRawPullRequest, mapGithubPullRequest } from "../src";

function rawPullRequest(
  overrides: Partial<GithubRawPullRequest> = {},
): GithubRawPullRequest {
  return {
    owner: "brocorp",
    repo: "aspex",
    number: 15,
    title: "Add GitHub adapter",
    url: "https://github.com/brocorp/aspex/pull/15",
    author: "johnl",
    headSha: "abc123",
    mergeable: true,
    matches: ["author"],
    checks: { failing: [], total: 1, green: true },
    approved: false,
    observedAt: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("GitHub PR mapping", () => {
  test("keeps one failing author/review PR with review and rerun actions", () => {
    const item = mapGithubPullRequest(
      rawPullRequest({
        matches: ["review_requested", "author"],
        checks: {
          failing: ["typecheck", "test"],
          total: 3,
          green: false,
          url: "https://github.com/brocorp/aspex/actions/runs/1",
        },
      }),
    );

    expect(item).toMatchObject({
      id: "github:pr:brocorp/aspex#15",
      source: "github",
      reason: "failing_ci",
      state: "needs_review",
      attentionRequired: true,
      summary: "#15 Add GitHub adapter - CI failing on 2 checks",
    });
    expect(item.actions?.map((action) => action.id).sort()).toEqual([
      "approve",
      "comment",
      "request_changes",
      "rerun",
    ]);
  });

  test("maps review-requested PRs to approve, comment, and request changes", () => {
    const item = mapGithubPullRequest(
      rawPullRequest({
        matches: ["review_requested"],
        checks: { failing: [], total: 1, green: true },
        approved: false,
        mergeable: true,
      }),
    );

    expect(item).toMatchObject({
      reason: "review_requested",
      state: "needs_review",
      attentionRequired: true,
    });
    expect(item.actions).toEqual([
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
      {
        id: "request_changes",
        label: "Request changes",
        risk: "safe",
        requiresConfirmation: false,
      },
    ]);
  });

  test("maps green approved author PR to dangerous merge action", () => {
    const item = mapGithubPullRequest(
      rawPullRequest({
        checks: { failing: [], total: 2, green: true },
        approved: true,
        mergeable: true,
      }),
    );

    expect(item).toMatchObject({
      reason: "awaiting_merge",
      state: "needs_review",
      attentionRequired: true,
    });
    expect(item.actions).toEqual([
      {
        id: "merge",
        label: "Merge",
        risk: "dangerous",
        requiresConfirmation: true,
      },
    ]);
    expect(
      item.actions?.some((action) => action.id === "request_changes"),
    ).toBe(false);
  });

  test("does not add request changes to author-only failing CI PRs", () => {
    const item = mapGithubPullRequest(
      rawPullRequest({
        matches: ["author"],
        checks: {
          failing: ["test"],
          total: 1,
          green: false,
          url: "https://github.com/brocorp/aspex/actions/runs/1",
        },
        approved: false,
        mergeable: true,
      }),
    );

    expect(item).toMatchObject({
      reason: "failing_ci",
      state: "needs_review",
      attentionRequired: true,
    });
    expect(item.actions).toEqual([
      {
        id: "rerun",
        label: "Re-run checks",
        risk: "medium",
        requiresConfirmation: true,
      },
    ]);
  });

  test("maps assignee PRs to review context attention", () => {
    const item = mapGithubPullRequest(
      rawPullRequest({
        matches: ["assignee"],
        checks: { failing: [], total: 0, green: false },
        approved: false,
        mergeable: null,
      }),
    );

    expect(item).toMatchObject({
      reason: "review_requested",
      state: "needs_review",
      attentionRequired: true,
    });
    expect(item.actions?.map((action) => action.id).sort()).toEqual([
      "approve",
      "comment",
      "request_changes",
    ]);
  });
});
