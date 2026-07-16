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

// What execute()'s work callback yields: the response entry, and whether it
// should be recorded for replay (only successful outcomes are, so transient
// failures stay retryable).
export interface LedgerOutcome {
  entry: LedgerEntry;
  record: boolean;
}

const DEFAULT_CAPACITY = 1024;

export class IntentLedger {
  // Map preserves insertion order; re-inserting on read keeps it LRU.
  private entries = new Map<string, LedgerEntry>();
  // In-flight work keyed by intentId: check-then-act around an await would let
  // two concurrent same-id requests both miss the ledger and both dispatch, so
  // the second request awaits the first instead.
  private inFlight = new Map<string, Promise<LedgerEntry>>();

  constructor(private capacity = DEFAULT_CAPACITY) {}

  // Runs work under the intentId's dedupe guarantee: a recorded outcome is
  // replayed, a concurrent request with the same id awaits the in-flight one,
  // and only a genuinely first request executes work.
  async execute(
    intentId: string,
    work: () => Promise<LedgerOutcome>,
  ): Promise<LedgerEntry> {
    const recorded = this.get(intentId);

    if (recorded !== null) {
      return recorded;
    }

    const pending = this.inFlight.get(intentId);

    if (pending !== undefined) {
      return pending;
    }

    const run = (async () => {
      try {
        const { entry, record } = await work();

        if (record) {
          this.record(intentId, entry);
        }

        return entry;
      } finally {
        this.inFlight.delete(intentId);
      }
    })();

    this.inFlight.set(intentId, run);
    return run;
  }

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
