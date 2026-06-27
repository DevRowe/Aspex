import type { AttentionItem, Signal } from "@aspex/schema";
import type { Bus } from "../bus";
import type { ItemStore } from "../store/itemStore";

export interface Derivers {
  deriveAttention: (item: AttentionItem) => AttentionItem;
  deriveLiveness: (item: AttentionItem) => AttentionItem;
}

const identityDerivers: Derivers = {
  deriveAttention: (item) => item,
  deriveLiveness: (item) => item,
};

export class WorldModel {
  constructor(
    private store: ItemStore,
    private bus: Bus,
    private derivers: Derivers = identityDerivers,
  ) {}

  applySignal(signal: Signal): void {
    const now = new Date();
    const existing = this.store.get(signal.id);
    const merged = mergeSignal(defaultsFor(signal, now), existing, signal, now);
    const derived = this.derivers.deriveLiveness(
      this.derivers.deriveAttention(merged),
    );

    this.store.upsert(derived);
    this.bus.emit("world:changed", { upserted: [derived], removed: [] });
  }

  snapshot(): AttentionItem[] {
    return this.store.getAll();
  }

  remove(id: string): void {
    this.store.remove(id);
    this.bus.emit("world:changed", { upserted: [], removed: [id] });
  }
}

function defaultsFor(signal: Signal, now: Date): AttentionItem {
  const observedAt = now.toISOString();

  return {
    id: signal.id,
    source: signal.source,
    project: signal.project ?? "",
    state: signal.state,
    liveness: "live",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
    summary: signal.summary ?? "",
    evidence: [],
    actions: [],
    observedAt,
    staleAfter: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  };
}

function mergeSignal(
  defaults: AttentionItem,
  existing: AttentionItem | null,
  signal: Signal,
  now: Date,
): AttentionItem {
  const merged = {
    ...defaults,
    ...(existing ?? {}),
    ...signal,
    observedAt: now.toISOString(),
  };

  if (signal.evidence === undefined) {
    merged.evidence = existing?.evidence ?? defaults.evidence;
  }

  if (signal.actions === undefined) {
    merged.actions = existing?.actions ?? defaults.actions;
  }

  return merged;
}
