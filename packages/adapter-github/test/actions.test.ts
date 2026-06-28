import { describe, expect, test } from "bun:test";
import { type GithubActionClient, runGithubAction } from "../src";

interface Call {
  method: string;
  params: unknown;
}

function actionClient(calls: Call[]): GithubActionClient {
  return {
    rest: {
      pulls: {
        merge: async (params) => {
          calls.push({ method: "pulls.merge", params });
        },
        createReview: async (params) => {
          calls.push({ method: "pulls.createReview", params });
        },
      },
      issues: {
        createComment: async (params) => {
          calls.push({ method: "issues.createComment", params });
        },
      },
      actions: {
        listWorkflowRunsForRepo: async (params) => {
          calls.push({ method: "actions.listWorkflowRunsForRepo", params });

          return { data: { workflow_runs: [{ id: 42 }] } };
        },
        reRunWorkflow: async (params) => {
          calls.push({ method: "actions.reRunWorkflow", params });
        },
      },
    },
  };
}

describe("GitHub actions", () => {
  test("keeps existing merge, approve, comment, and rerun behavior", async () => {
    const calls: Call[] = [];
    const client = actionClient(calls);

    await expect(
      runGithubAction(client, "github:pr:brocorp/aspex#15", "merge", undefined),
    ).resolves.toEqual({ ok: true, message: "merged pull request" });
    await expect(
      runGithubAction(client, "github:pr:brocorp/aspex#15", "approve", {
        body: "looks good",
      }),
    ).resolves.toEqual({ ok: true, message: "approved pull request" });
    await expect(
      runGithubAction(client, "github:pr:brocorp/aspex#15", "comment", {
        body: "  thanks  ",
      }),
    ).resolves.toEqual({ ok: true, message: "commented on pull request" });
    await expect(
      runGithubAction(client, "github:pr:brocorp/aspex#15", "rerun", {
        headSha: "abc123",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "re-ran pull request checks",
    });

    expect(calls).toEqual([
      {
        method: "pulls.merge",
        params: { owner: "brocorp", repo: "aspex", pull_number: 15 },
      },
      {
        method: "pulls.createReview",
        params: {
          owner: "brocorp",
          repo: "aspex",
          pull_number: 15,
          event: "APPROVE",
          body: "looks good",
        },
      },
      {
        method: "issues.createComment",
        params: {
          owner: "brocorp",
          repo: "aspex",
          issue_number: 15,
          body: "thanks",
        },
      },
      {
        method: "actions.listWorkflowRunsForRepo",
        params: {
          owner: "brocorp",
          repo: "aspex",
          head_sha: "abc123",
          per_page: 1,
        },
      },
      {
        method: "actions.reRunWorkflow",
        params: { owner: "brocorp", repo: "aspex", run_id: 42 },
      },
    ]);
  });

  test("request_changes creates a REQUEST_CHANGES review with trimmed body", async () => {
    const calls: Call[] = [];

    await expect(
      runGithubAction(
        actionClient(calls),
        "github:pr:brocorp/aspex#15",
        "request_changes",
        { body: "  fix auth  " },
      ),
    ).resolves.toEqual({
      ok: true,
      message: "requested changes on pull request",
    });

    expect(calls).toEqual([
      {
        method: "pulls.createReview",
        params: {
          owner: "brocorp",
          repo: "aspex",
          pull_number: 15,
          event: "REQUEST_CHANGES",
          body: "fix auth",
        },
      },
    ]);
  });

  test("request_changes requires a non-empty body before calling Octokit", async () => {
    const calls: Call[] = [];

    await expect(
      runGithubAction(
        actionClient(calls),
        "github:pr:brocorp/aspex#15",
        "request_changes",
        { body: "   " },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "request_changes needs a body",
    });

    expect(calls).toEqual([]);
  });
});
