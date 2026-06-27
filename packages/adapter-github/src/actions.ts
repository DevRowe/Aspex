import type { ActionResult } from "@aspex/schema";

export interface GithubActionClient {
  rest: {
    pulls: {
      merge(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<unknown>;
      createReview(params: {
        owner: string;
        repo: string;
        pull_number: number;
        event: "APPROVE" | "COMMENT";
        body?: string;
      }): Promise<unknown>;
    };
    issues: {
      createComment(params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }): Promise<unknown>;
    };
    actions?: {
      listWorkflowRunsForRepo(params: {
        owner: string;
        repo: string;
        head_sha: string;
        per_page?: number;
      }): Promise<{ data: { workflow_runs: Array<{ id: number }> } }>;
      reRunWorkflow(params: {
        owner: string;
        repo: string;
        run_id: number;
      }): Promise<unknown>;
    };
  };
}

export interface GithubActionPayload {
  body?: string;
  headSha?: string;
}

export async function runGithubAction(
  client: GithubActionClient,
  itemId: string,
  actionId: string,
  payload: unknown,
): Promise<ActionResult> {
  const ref = parseGithubPrItemId(itemId);

  if (ref === null) {
    return { ok: false, message: "Invalid GitHub PR item id" };
  }

  const body = isPayload(payload) ? payload.body : undefined;

  if (actionId === "merge") {
    await client.rest.pulls.merge({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });

    return { ok: true, message: "merged pull request" };
  }

  if (actionId === "approve") {
    await client.rest.pulls.createReview({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      event: "APPROVE",
      body,
    });

    return { ok: true, message: "approved pull request" };
  }

  if (actionId === "comment") {
    const commentBody = body?.trim();

    if (commentBody === undefined || commentBody === "") {
      return { ok: false, message: "Comment body is required" };
    }

    await client.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      body: commentBody,
    });

    return { ok: true, message: "commented on pull request" };
  }

  if (actionId === "rerun") {
    return rerunGithubChecks(client, ref, payload);
  }

  return { ok: false, message: "Unknown GitHub action" };
}

function parseGithubPrItemId(
  itemId: string,
): { owner: string; repo: string; number: number } | null {
  const match = /^github:pr:([^/]+)\/([^#]+)#(\d+)$/.exec(itemId);

  if (match === null) {
    return null;
  }

  const [, owner, repo, rawNumber] = match;
  const number = Number(rawNumber);

  if (
    owner === undefined ||
    repo === undefined ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return { owner, repo, number };
}

async function rerunGithubChecks(
  client: GithubActionClient,
  ref: { owner: string; repo: string; number: number },
  payload: unknown,
): Promise<ActionResult> {
  if (client.rest.actions === undefined) {
    return { ok: false, message: "GitHub Actions API is unavailable" };
  }

  if (!isPayload(payload) || payload.headSha === undefined) {
    return { ok: false, message: "headSha is required to re-run checks" };
  }

  const runs = await client.rest.actions.listWorkflowRunsForRepo({
    owner: ref.owner,
    repo: ref.repo,
    head_sha: payload.headSha,
    per_page: 1,
  });
  const runId = runs.data.workflow_runs[0]?.id;

  if (runId === undefined) {
    return {
      ok: false,
      message: "No workflow run found for pull request head",
    };
  }

  await client.rest.actions.reRunWorkflow({
    owner: ref.owner,
    repo: ref.repo,
    run_id: runId,
  });

  return { ok: true, message: "re-ran pull request checks" };
}

function isPayload(payload: unknown): payload is GithubActionPayload {
  return typeof payload === "object" && payload !== null;
}
