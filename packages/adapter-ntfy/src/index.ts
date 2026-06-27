import type { AttentionItem, Reason, Severity } from "@aspex/schema";

export interface NtfyConfig {
  server?: string;
  topic: string;
  minSeverity?: Extract<Severity, "medium" | "high">;
}

export interface NtfyBus {
  on(
    event: "world:changed",
    fn: (change: { upserted: AttentionItem[]; removed: string[] }) => void,
  ): void;
}

export interface NtfyNotifierOptions {
  fetch?: FetchFn;
  log?: (message: string) => void;
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_SERVER = "https://ntfy.sh";
const DEFAULT_MIN_SEVERITY: Extract<Severity, "medium" | "high"> = "high";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const NTFY_PRIORITY: Record<Severity, string> = {
  info: "1",
  low: "2",
  medium: "3",
  high: "4",
};

const REASON_LABEL: Record<Reason, string> = {
  blocked_on_human: "Blocked on human",
  failing_ci: "Failing CI",
  review_requested: "Review requested",
  awaiting_merge: "Awaiting merge",
  errored: "Errored",
  ambient: "Ambient",
};

export class NtfyNotifier {
  private notifiable = new Map<string, boolean>();
  private fetchImpl: FetchFn;
  private log: (message: string) => void;

  constructor(
    private cfg: NtfyConfig,
    bus: NtfyBus,
    options: NtfyNotifierOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.log = options.log ?? console.warn;

    bus.on("world:changed", ({ upserted }) => {
      for (const item of upserted) {
        void this.maybeNotify(item);
      }
    });
  }

  async maybeNotify(item: AttentionItem): Promise<void> {
    const wasNotifiable = this.notifiable.get(item.id) ?? false;
    const isNotifiable = this.isNotifiable(item);

    this.notifiable.set(item.id, isNotifiable);

    if (wasNotifiable || !isNotifiable) {
      return;
    }

    try {
      const response = await this.fetchImpl(this.url(), {
        method: "POST",
        headers: this.headers(item),
        body: item.summary,
      });

      if (!response.ok) {
        this.log(
          `ntfy publish failed for ${item.id}: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      this.log(`ntfy publish failed for ${item.id}: ${messageFor(error)}`);
    }
  }

  private isNotifiable(item: AttentionItem): boolean {
    return (
      item.attentionRequired &&
      item.reason !== "ambient" &&
      severityAtLeast(
        item.severity,
        this.cfg.minSeverity ?? DEFAULT_MIN_SEVERITY,
      )
    );
  }

  private url(): string {
    const server = this.cfg.server ?? DEFAULT_SERVER;
    return `${server.replace(/\/+$/, "")}/${encodeURIComponent(this.cfg.topic)}`;
  }

  private headers(item: AttentionItem): HeadersInit {
    const click = clickUrl(item);

    return {
      Title: reasonLabel(item.reason),
      Priority: ntfyPriority(item.severity),
      ...(click !== undefined ? { Click: click } : {}),
    };
  }
}

function severityAtLeast(
  severity: Severity,
  minSeverity: Extract<Severity, "medium" | "high">,
): boolean {
  return severityRank(severity) >= severityRank(minSeverity);
}

function clickUrl(item: AttentionItem): string | undefined {
  return item.deepLink ?? item.evidence.find(hasUrl)?.url;
}

function hasUrl(entry: { url?: string }): entry is { url: string } {
  return entry.url !== undefined;
}

function reasonLabel(reason: Reason): string {
  return REASON_LABEL[reason] ?? reason;
}

function ntfyPriority(severity: Severity): string {
  return NTFY_PRIORITY[severity] ?? NTFY_PRIORITY.info;
}

function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.info;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
