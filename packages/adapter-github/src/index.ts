import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
  Signal,
} from "@aspex/schema";
import { errorMessage, githubItemId, isRecord } from "@aspex/schema";
import { Octokit } from "@octokit/rest";
import { type GithubActionClient, runGithubAction } from "./actions";
import {
  type DiscoverGithubOptions,
  type GithubRestClient,
  discoverGithubPullRequests,
} from "./discover";
import { type GithubRawPullRequest, mapGithubPullRequest } from "./map";

export interface GithubAdapterOptions {
  token: string;
  allowlist?: string[];
  pollIntervalMs?: number;
  client?: GithubRestClient & GithubActionClient;
  setInterval?: SetIntervalFn;
  clearInterval?: ClearIntervalFn;
}

type IntervalHandle = ReturnType<typeof setInterval>;
type SetIntervalFn = (fn: () => void, delayMs: number) => IntervalHandle;
type ClearIntervalFn = (timer: IntervalHandle) => void;

const MIN_POLL_INTERVAL_MS = 60_000;

export class GithubAdapter implements Adapter {
  id = "github";
  private readonly allowlist: string[];
  private readonly pollIntervalMs: number;
  private readonly client: GithubRestClient & GithubActionClient;
  private readonly setTimer: SetIntervalFn;
  private readonly clearTimer: ClearIntervalFn;
  private timer: IntervalHandle | null = null;
  private running = false;
  private readonly checkCache: NonNullable<
    DiscoverGithubOptions["checkCache"]
  > = new Map();
  private readonly actionsByItem = new Map<string, Action[]>();
  private readonly rawByItem = new Map<string, GithubRawPullRequest>();

  constructor(options: GithubAdapterOptions) {
    this.allowlist = options.allowlist ?? [];
    this.pollIntervalMs = Math.max(
      options.pollIntervalMs ?? MIN_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
    );
    this.client =
      options.client ??
      (new Octokit({ auth: options.token }) as GithubRestClient &
        GithubActionClient);
    this.setTimer = options.setInterval ?? setInterval;
    this.clearTimer = options.clearInterval ?? clearInterval;
  }

  async start(ctx: AdapterContext): Promise<void> {
    await this.stop();
    await this.poll(ctx);
    this.timer = this.setTimer(() => {
      void this.poll(ctx);
    }, this.pollIntervalMs);
  }

  listActions(itemId: string): Action[] {
    return this.actionsByItem.get(itemId) ?? [];
  }

  async runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    const raw = this.rawByItem.get(itemId);
    const enrichedPayload =
      raw === undefined
        ? payload
        : {
            ...(isRecord(payload) ? payload : {}),
            headSha: raw.headSha,
          };

    return runGithubAction(this.client, itemId, actionId, enrichedPayload);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  async poll(ctx: AdapterContext): Promise<Signal[]> {
    if (this.running) {
      return [];
    }

    this.running = true;

    try {
      const rawPullRequests = await discoverGithubPullRequests(this.client, {
        allowlist: this.allowlist,
        checkCache: this.checkCache,
      });
      const signals = rawPullRequests.map((pr) => mapGithubPullRequest(pr));

      for (const signal of signals) {
        if (signal.actions !== undefined) {
          this.actionsByItem.set(signal.id, signal.actions);
        }

        const raw = rawPullRequests.find(
          (pr) => githubItemId(pr) === signal.id,
        );

        if (raw !== undefined) {
          this.rawByItem.set(signal.id, raw);
        }

        ctx.emit(signal);
      }

      this.sweepCaches(rawPullRequests);
      ctx.heartbeat("github");
      ctx.log(`discovered ${signals.length} GitHub pull requests`);

      return signals;
    } catch (error) {
      ctx.log(`GitHub discovery failed: ${errorMessage(error)}`);

      return [];
    } finally {
      this.running = false;
    }
  }

  // Drop cache entries for PRs (and head SHAs) that left the current poll
  // cycle - merged/closed PRs and superseded pushes - mirroring the
  // adapter-giles departed-task sweep. The Hub runs ambiently for days, so
  // unbounded per-SHA and per-item maps are a real leak. Only reached on a
  // successful poll, so a transient discovery failure cannot mass-evict.
  private sweepCaches(rawPullRequests: GithubRawPullRequest[]): void {
    const liveItems = new Set(rawPullRequests.map((pr) => githubItemId(pr)));
    const liveShas = new Set(
      rawPullRequests.map((pr) => `${pr.owner}/${pr.repo}@${pr.headSha}`),
    );

    for (const itemId of this.actionsByItem.keys()) {
      if (!liveItems.has(itemId)) {
        this.actionsByItem.delete(itemId);
      }
    }

    for (const itemId of this.rawByItem.keys()) {
      if (!liveItems.has(itemId)) {
        this.rawByItem.delete(itemId);
      }
    }

    for (const key of this.checkCache.keys()) {
      if (!liveShas.has(key)) {
        this.checkCache.delete(key);
      }
    }
  }
}

export * from "./actions";
export * from "./discover";
export * from "./map";
