import { describe, expect, test } from "bun:test";
import type { AdapterContext } from "@aspex/schema";
import {
  GithubAdapter,
  type GithubRestClient,
  discoverGithubPullRequests,
  githubSearchQueries,
  mapGithubPullRequest,
} from "../src";

interface Call {
  method: string;
  params: unknown;
}

function makeClient(): GithubRestClient {
  const pulls = new Map([
    [
      "brocorp/aspex#15",
      {
        number: 15,
        title: "Add GitHub adapter",
        html_url: "https://github.com/brocorp/aspex/pull/15",
        mergeable: true,
        user: { login: "johnl" },
        head: { sha: "fail-sha" },
        base: { repo: { name: "aspex", owner: { login: "brocorp" } } },
      },
    ],
    [
      "brocorp/aspex#16",
      {
        number: 16,
        title: "Ship green PR",
        html_url: "https://github.com/brocorp/aspex/pull/16",
        mergeable: true,
        user: { login: "johnl" },
        head: { sha: "green-sha" },
        base: { repo: { name: "aspex", owner: { login: "brocorp" } } },
      },
    ],
  ]);
  const calls: Call[] = [];

  return {
    calls,
    rest: {
      search: {
        issuesAndPullRequests: async (params) => {
          calls.push({ method: "search", params });

          if (params.q.includes("review-requested:@me")) {
            return { data: { items: [searchItem(15)] } };
          }

          if (params.q.includes("author:@me")) {
            return { data: { items: [searchItem(15), searchItem(16)] } };
          }

          return { data: { items: [] } };
        },
      },
      pulls: {
        get: async (params) => {
          calls.push({ method: "pulls.get", params });
          const key = `${params.owner}/${params.repo}#${params.pull_number}`;
          const pull = pulls.get(key);

          if (pull === undefined) {
            throw new Error(`missing pull fixture ${key}`);
          }

          return { data: pull };
        },
        listReviews: async (params) => {
          calls.push({ method: "pulls.listReviews", params });

          return {
            data:
              params.pull_number === 16
                ? [{ state: "APPROVED", submitted_at: "2026-06-28T00:00:00Z" }]
                : [],
          };
        },
      },
      checks: {
        listForRef: async (params) => {
          calls.push({ method: "checks.listForRef", params });

          return {
            data: {
              check_runs:
                params.ref === "fail-sha"
                  ? [
                      {
                        name: "typecheck",
                        conclusion: "failure",
                        status: "completed",
                      },
                    ]
                  : [
                      {
                        name: "test",
                        conclusion: "success",
                        status: "completed",
                      },
                    ],
            },
            headers: { etag: `"${params.ref}"` },
          };
        },
      },
      repos: {
        getCombinedStatusForRef: async (params) => {
          calls.push({ method: "repos.getCombinedStatusForRef", params });

          return {
            data: {
              state: params.ref === "fail-sha" ? "failure" : "success",
              statuses:
                params.ref === "fail-sha"
                  ? [{ context: "lint", state: "failure" }]
                  : [{ context: "lint", state: "success" }],
            },
            headers: { etag: `"status-${params.ref}"` },
          };
        },
      },
    },
  } as GithubRestClient & { calls: Call[] };
}

function searchItem(number: number) {
  return {
    number,
    title: number === 15 ? "Add GitHub adapter" : "Ship green PR",
    html_url: `https://github.com/brocorp/aspex/pull/${number}`,
    repository_url: "https://api.github.com/repos/brocorp/aspex",
    user: { login: "johnl" },
    pull_request: {
      html_url: `https://github.com/brocorp/aspex/pull/${number}`,
    },
  };
}

function context(): {
  ctx: AdapterContext;
  emitted: unknown[];
  heartbeats: string[];
} {
  const emitted: unknown[] = [];
  const heartbeats: string[] = [];

  return {
    ctx: {
      emit: (signal) => emitted.push(signal),
      heartbeat: (source) => heartbeats.push(source),
      log: () => undefined,
    },
    emitted,
    heartbeats,
  };
}

describe("GitHub discovery", () => {
  test("deduplicates viewer-centric search results into one item per PR", async () => {
    const client = makeClient();
    const rawPullRequests = await discoverGithubPullRequests(client);
    const items = rawPullRequests.map((pr) => mapGithubPullRequest(pr));

    expect(items).toHaveLength(2);
    expect(
      items.filter((item) => item.id === "github:pr:brocorp/aspex#15"),
    ).toHaveLength(1);
    expect(
      items.find((item) => item.id === "github:pr:brocorp/aspex#15"),
    ).toMatchObject({
      reason: "failing_ci",
    });
    expect(
      items
        .find((item) => item.id === "github:pr:brocorp/aspex#15")
        ?.actions?.map((action) => action.id)
        .sort(),
    ).toEqual(["approve", "comment", "request_changes", "rerun"]);
    expect(
      items.find((item) => item.id === "github:pr:brocorp/aspex#16"),
    ).toMatchObject({
      reason: "awaiting_merge",
    });
  });

  test("issues one fixed search set, not per-repository enumeration", async () => {
    const client = makeClient() as GithubRestClient & { calls: Call[] };

    await discoverGithubPullRequests(client, {
      allowlist: ["dependabot", "brocorp/aspex"],
    });

    const searchCalls = client.calls.filter((call) => call.method === "search");

    expect(searchCalls.map((call) => (call.params as { q: string }).q)).toEqual(
      githubSearchQueries(["dependabot", "brocorp/aspex"]).map(
        (query) => query.q,
      ),
    );
    expect(
      searchCalls.some((call) =>
        (call.params as { q: string }).q.includes("user:"),
      ),
    ).toBe(false);
  });

  test("uses independent ETags for check runs and combined status", async () => {
    let checkRunCalls = 0;
    let statusCalls = 0;
    const client = {
      rest: {
        search: {
          issuesAndPullRequests: async (params: { q: string }) => {
            if (params.q.includes("author:@me")) {
              return { data: { items: [searchItem(15)] } };
            }

            return { data: { items: [] } };
          },
        },
        pulls: {
          get: async () => ({
            data: {
              number: 15,
              title: "Add GitHub adapter",
              html_url: "https://github.com/brocorp/aspex/pull/15",
              mergeable: true,
              user: { login: "johnl" },
              head: { sha: "etag-sha" },
              base: { repo: { name: "aspex", owner: { login: "brocorp" } } },
            },
          }),
          listReviews: async () => ({ data: [] }),
        },
        checks: {
          listForRef: async (
            _params: unknown,
            options?: { headers?: Record<string, string> },
          ) => {
            checkRunCalls += 1;

            if (checkRunCalls === 1) {
              expect(options).toBeUndefined();

              return {
                data: {
                  check_runs: [
                    {
                      name: "test",
                      conclusion: "success",
                      status: "completed",
                    },
                  ],
                },
                headers: { etag: '"checks-1"' },
              };
            }

            expect(options?.headers).toEqual({
              "if-none-match": '"checks-1"',
            });
            throw { status: 304 };
          },
        },
        repos: {
          getCombinedStatusForRef: async (
            _params: unknown,
            options?: { headers?: Record<string, string> },
          ) => {
            statusCalls += 1;

            if (statusCalls === 1) {
              expect(options).toBeUndefined();

              return {
                data: {
                  state: "success",
                  statuses: [{ context: "lint", state: "success" }],
                },
                headers: { etag: '"status-1"' },
              };
            }

            expect(options?.headers).toEqual({
              "if-none-match": '"status-1"',
            });

            return {
              data: {
                state: "failure",
                statuses: [{ context: "lint", state: "failure" }],
              },
              headers: { etag: '"status-2"' },
            };
          },
        },
      },
    };
    const checkCache = new Map();

    const first = await discoverGithubPullRequests(client as never, {
      checkCache,
    });
    const second = await discoverGithubPullRequests(client as never, {
      checkCache,
    });

    expect(first[0]?.checks).toMatchObject({ failing: [], green: true });
    expect(second[0]?.checks).toMatchObject({
      failing: ["lint"],
      green: false,
    });
  });

  test("runAction dispatches merge and approve through Octokit", async () => {
    const calls: Call[] = [];
    const client = {
      rest: {
        pulls: {
          merge: async (params: unknown) => {
            calls.push({ method: "pulls.merge", params });
          },
          createReview: async (params: unknown) => {
            calls.push({ method: "pulls.createReview", params });
          },
        },
        issues: {
          createComment: async (params: unknown) => {
            calls.push({ method: "issues.createComment", params });
          },
        },
      },
    };
    const adapter = new GithubAdapter({
      token: "test-token",
      client: client as never,
    });

    await expect(
      adapter.runAction("github:pr:brocorp/aspex#15", "merge"),
    ).resolves.toEqual({ ok: true, message: "merged pull request" });
    await expect(
      adapter.runAction("github:pr:brocorp/aspex#15", "approve"),
    ).resolves.toEqual({ ok: true, message: "approved pull request" });

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
        },
      },
    ]);
  });

  test("adapter heartbeats only after successful discovery", async () => {
    const client = makeClient();
    const { ctx, emitted, heartbeats } = context();
    const adapter = new GithubAdapter({
      token: "test-token",
      client: client as never,
      setInterval: (() => 1) as never,
      clearInterval: (() => undefined) as never,
    });

    await adapter.start(ctx);

    expect(emitted).toHaveLength(2);
    expect(heartbeats).toEqual(["github"]);
    await adapter.stop();
  });
});
