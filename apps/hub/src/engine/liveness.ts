import type { AttentionItem, Liveness, Source, State } from "@aspex/schema";

const FAR_FUTURE_MS = Date.UTC(9999, 0, 1);

export const TERMINAL = new Set<State>(["done"]);
export const POLLED = new Set<Source>(["github"]);

export interface LivenessConfig {
  pollGraceMs: number;
  heartbeatGraceMs: number;
  quietAfterMs: number;
  staleAfterMs: number;
  lostAfterMs: number;
}

export function nextStaleAfter(
  source: Source,
  state: State,
  observedAtIso: string,
  cfg: LivenessConfig,
): string {
  if (TERMINAL.has(state)) {
    return new Date(FAR_FUTURE_MS).toISOString();
  }

  const observedAt = Date.parse(observedAtIso);
  const graceMs = POLLED.has(source) ? cfg.pollGraceMs : cfg.heartbeatGraceMs;

  return new Date(observedAt + graceMs).toISOString();
}

export function livenessAt(
  item: AttentionItem,
  now: number,
  cfg: LivenessConfig,
): Liveness {
  if (TERMINAL.has(item.state)) {
    return "live";
  }

  const overdueMs = now - Date.parse(item.staleAfter);

  if (overdueMs < cfg.quietAfterMs) {
    return "live";
  }

  if (overdueMs < cfg.staleAfterMs) {
    return "quiet";
  }

  if (overdueMs < cfg.lostAfterMs) {
    return "stale";
  }

  return "lost";
}

export class LivenessTicker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getItems: () => AttentionItem[],
    private onChange: (item: AttentionItem) => void,
    private cfg: LivenessConfig,
    private now: () => number = () => Date.now(),
  ) {}

  start(intervalMs = 10_000): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      const now = this.now();

      for (const item of this.getItems()) {
        const liveness = livenessAt(item, now, this.cfg);

        if (liveness !== item.liveness) {
          this.onChange({ ...item, liveness });
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  heartbeat(source: string, items: AttentionItem[]): AttentionItem[] {
    const observedAt = new Date(this.now()).toISOString();

    return items.map((item) => {
      if (item.source !== source) {
        return item;
      }

      const staleAfter = nextStaleAfter(
        item.source,
        item.state,
        observedAt,
        this.cfg,
      );
      const updated = { ...item, staleAfter };

      return {
        ...updated,
        liveness: livenessAt(updated, Date.parse(observedAt), this.cfg),
      };
    });
  }
}
