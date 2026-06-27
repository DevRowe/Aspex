import type {
  GithubCheckSummary,
  GithubPrMatch,
  GithubRawPullRequest,
} from "./map";

export interface GithubSearchItem {
  number: number;
  title: string;
  html_url: string;
  repository_url?: string;
  user?: { login?: string | null } | null;
  pull_request?: { url?: string; html_url?: string } | null;
}

export interface GithubRestClient {
  rest: {
    search: {
      issuesAndPullRequests(params: {
        q: string;
        per_page?: number;
      }): Promise<{ data: { items: GithubSearchItem[] } }>;
    };
    pulls: {
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: GithubPullResponse }>;
      listReviews(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: GithubReviewResponse[] }>;
    };
    checks: {
      listForRef(
        params: {
          owner: string;
          repo: string;
          ref: string;
          per_page?: number;
        },
        options?: { headers?: Record<string, string> },
      ): Promise<{
        data: { check_runs: GithubCheckRunResponse[] };
        headers?: Record<string, string | undefined>;
      }>;
    };
    repos: {
      getCombinedStatusForRef(
        params: {
          owner: string;
          repo: string;
          ref: string;
        },
        options?: { headers?: Record<string, string> },
      ): Promise<{
        data: {
          state: string;
          statuses: GithubStatusResponse[];
        };
        headers?: Record<string, string | undefined>;
      }>;
    };
  };
}

export interface GithubPullResponse {
  number: number;
  title: string;
  html_url: string;
  mergeable: boolean | null;
  user?: { login?: string | null } | null;
  head: { sha: string };
  base: { repo: { name: string; owner: { login: string } } };
}

export interface GithubReviewResponse {
  state?: string | null;
  submitted_at?: string | null;
}

export interface GithubCheckRunResponse {
  name?: string | null;
  conclusion?: string | null;
  status?: string | null;
  html_url?: string | null;
}

export interface GithubStatusResponse {
  context?: string | null;
  state?: string | null;
  target_url?: string | null;
}

interface DiscoveryRecord {
  owner: string;
  repo: string;
  number: number;
  matches: Set<GithubPrMatch>;
}

interface CachedCheckResult {
  checkRunsEtag?: string;
  combinedStatusEtag?: string;
  checkRuns: GithubCheckRunResponse[];
  statuses: GithubStatusResponse[];
  checks: GithubCheckSummary;
}

export interface DiscoverGithubOptions {
  allowlist?: string[];
  perPage?: number;
  checkCache?: Map<string, CachedCheckResult>;
}

const SEARCH_PREFIX = "is:open is:pr";
const FAILING_CHECK_STATES = new Set([
  "failure",
  "error",
  "timed_out",
  "cancelled",
  "action_required",
]);
const GREEN_CHECK_STATES = new Set(["success", "neutral", "skipped"]);

export async function discoverGithubPullRequests(
  client: GithubRestClient,
  options: DiscoverGithubOptions = {},
): Promise<GithubRawPullRequest[]> {
  const records = new Map<string, DiscoveryRecord>();

  for (const query of githubSearchQueries(options.allowlist ?? [])) {
    const response = await client.rest.search.issuesAndPullRequests({
      q: query.q,
      per_page: options.perPage ?? 50,
    });

    for (const item of response.data.items) {
      const repoRef = repoRefFromSearchItem(item);

      if (repoRef === null) {
        continue;
      }

      const key = `${repoRef.owner}/${repoRef.repo}#${item.number}`;
      const record = records.get(key) ?? {
        ...repoRef,
        number: item.number,
        matches: new Set<GithubPrMatch>(),
      };

      record.matches.add(query.match);
      records.set(key, record);
    }
  }

  const rawPullRequests: GithubRawPullRequest[] = [];

  for (const record of records.values()) {
    const pullResponse = await client.rest.pulls.get({
      owner: record.owner,
      repo: record.repo,
      pull_number: record.number,
    });
    const pr = pullResponse.data;
    const matches = [...record.matches];
    const shouldFetchChecks =
      matches.includes("author") || matches.includes("allowlist");
    const checks = shouldFetchChecks
      ? await fetchChecks(
          client,
          record.owner,
          record.repo,
          pr.head.sha,
          options,
        )
      : emptyChecks();
    const approved = shouldFetchChecks
      ? await fetchApproved(client, record.owner, record.repo, record.number)
      : false;

    rawPullRequests.push({
      owner: pr.base.repo.owner.login,
      repo: pr.base.repo.name,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      author: pr.user?.login ?? undefined,
      headSha: pr.head.sha,
      mergeable: pr.mergeable,
      matches,
      checks,
      approved,
    });
  }

  return rawPullRequests;
}

export function githubSearchQueries(
  allowlist: string[] = [],
): Array<{ q: string; match: GithubPrMatch }> {
  const base = [
    { q: `${SEARCH_PREFIX} review-requested:@me`, match: "review_requested" },
    { q: `${SEARCH_PREFIX} author:@me`, match: "author" },
    { q: `${SEARCH_PREFIX} assignee:@me`, match: "assignee" },
  ] satisfies Array<{ q: string; match: GithubPrMatch }>;

  return [
    ...base,
    ...allowlist.map((entry) => ({
      q: `${SEARCH_PREFIX} ${allowlistQualifier(entry)}`,
      match: "allowlist" as const,
    })),
  ];
}

async function fetchChecks(
  client: GithubRestClient,
  owner: string,
  repo: string,
  sha: string,
  options: DiscoverGithubOptions,
): Promise<GithubCheckSummary> {
  const key = `${owner}/${repo}@${sha}`;
  const cached = options.checkCache?.get(key);

  const [checkRuns, combinedStatus] = await Promise.all([
    fetchCheckRuns(client, owner, repo, sha, cached),
    fetchCombinedStatus(client, owner, repo, sha, cached),
  ]);
  const checks = summarizeChecks(checkRuns.items, combinedStatus.items);

  options.checkCache?.set(key, {
    checkRunsEtag: checkRuns.etag,
    combinedStatusEtag: combinedStatus.etag,
    checkRuns: checkRuns.items,
    statuses: combinedStatus.items,
    checks,
  });

  return checks;
}

async function fetchCheckRuns(
  client: GithubRestClient,
  owner: string,
  repo: string,
  sha: string,
  cached: CachedCheckResult | undefined,
): Promise<{ items: GithubCheckRunResponse[]; etag?: string }> {
  const headers =
    cached?.checkRunsEtag !== undefined
      ? { "if-none-match": cached.checkRunsEtag }
      : undefined;

  try {
    const response = await client.rest.checks.listForRef(
      { owner, repo, ref: sha, per_page: 100 },
      headers === undefined ? undefined : { headers },
    );

    return {
      items: response.data.check_runs,
      etag: response.headers?.etag ?? cached?.checkRunsEtag,
    };
  } catch (error) {
    if (isNotModified(error) && cached !== undefined) {
      return { items: cached.checkRuns, etag: cached.checkRunsEtag };
    }

    throw error;
  }
}

async function fetchCombinedStatus(
  client: GithubRestClient,
  owner: string,
  repo: string,
  sha: string,
  cached: CachedCheckResult | undefined,
): Promise<{ items: GithubStatusResponse[]; etag?: string }> {
  const headers =
    cached?.combinedStatusEtag !== undefined
      ? { "if-none-match": cached.combinedStatusEtag }
      : undefined;

  try {
    const response = await client.rest.repos.getCombinedStatusForRef(
      { owner, repo, ref: sha },
      headers === undefined ? undefined : { headers },
    );

    return {
      items: response.data.statuses,
      etag: response.headers?.etag ?? cached?.combinedStatusEtag,
    };
  } catch (error) {
    if (isNotModified(error) && cached !== undefined) {
      return { items: cached.statuses, etag: cached.combinedStatusEtag };
    }

    throw error;
  }
}

async function fetchApproved(
  client: GithubRestClient,
  owner: string,
  repo: string,
  number: number,
): Promise<boolean> {
  const response = await client.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: number,
  });
  const latestState = response.data
    .filter((review) => review.state !== undefined && review.state !== null)
    .toSorted((a, b) =>
      (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""),
    )
    .at(-1)?.state;

  return latestState === "APPROVED";
}

function summarizeChecks(
  checkRuns: GithubCheckRunResponse[],
  statuses: GithubStatusResponse[],
): GithubCheckSummary {
  const failing = [
    ...checkRuns
      .filter((check) => FAILING_CHECK_STATES.has(check.conclusion ?? ""))
      .map((check) => check.name ?? "check"),
    ...statuses
      .filter((status) => FAILING_CHECK_STATES.has(status.state ?? ""))
      .map((status) => status.context ?? "status"),
  ];
  const total = checkRuns.length + statuses.length;
  const green =
    total > 0 &&
    checkRuns.every((check) =>
      GREEN_CHECK_STATES.has(check.conclusion ?? ""),
    ) &&
    statuses.every((status) => status.state === "success");
  const url =
    checkRuns.find(
      (check) => check.html_url !== undefined && check.html_url !== null,
    )?.html_url ??
    statuses.find(
      (status) => status.target_url !== undefined && status.target_url !== null,
    )?.target_url ??
    undefined;

  return { failing, total, green, url };
}

function emptyChecks(): GithubCheckSummary {
  return { failing: [], total: 0, green: false };
}

function allowlistQualifier(entry: string): string {
  const trimmed = entry.trim();

  if (trimmed.startsWith("author:") || trimmed.startsWith("repo:")) {
    return trimmed;
  }

  return trimmed.includes("/") ? `repo:${trimmed}` : `author:${trimmed}`;
}

function repoRefFromSearchItem(
  item: GithubSearchItem,
): { owner: string; repo: string } | null {
  const repositoryUrl = item.repository_url;

  if (repositoryUrl === undefined) {
    return null;
  }

  const marker = "/repos/";
  const markerIndex = repositoryUrl.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const [owner, repo] = repositoryUrl
    .slice(markerIndex + marker.length)
    .split("/");

  if (
    owner === undefined ||
    repo === undefined ||
    owner === "" ||
    repo === ""
  ) {
    return null;
  }

  return { owner, repo };
}

function isNotModified(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 304
  );
}
