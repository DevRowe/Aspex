// Bounded LRU of processed direction intents (design section 2.6): a glance-
// and-speak client over a flaky tailnet can lose a response after the action
// committed, so a natural "did that go through?" retry must return the cached
// ack instead of re-dispatching (double-merge, double-spawn). The orchestrator
// inbox filename is the durable backstop; this ledger is the fast path. Only
// successful outcomes are recorded so a transient failure stays retryable.

export interface LedgerEntry {
  status: number;
  body: unknown;
}

const DEFAULT_CAPACITY = 1024;

export class IntentLedger {
  // Map preserves insertion order; re-inserting on read keeps it LRU.
  private entries = new Map<string, LedgerEntry>();

  constructor(private capacity = DEFAULT_CAPACITY) {}

  get(intentId: string): LedgerEntry | null {
    const entry = this.entries.get(intentId);

    if (entry === undefined) {
      return null;
    }

    this.entries.delete(intentId);
    this.entries.set(intentId, entry);

    return entry;
  }

  record(intentId: string, entry: LedgerEntry): void {
    this.entries.delete(intentId);
    this.entries.set(intentId, entry);

    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }
  }
}
