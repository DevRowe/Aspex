// Bounded LRU of processed direction intents (design section 2.6): a glance-
// and-speak client over a flaky tailnet can lose a response after the action
// committed, so a natural "did that go through?" retry must return the cached
// ack instead of re-dispatching (double-merge, double-spawn). The orchestrator
// inbox filename is the durable backstop; this ledger is the fast path. Only
// successful outcomes are recorded so a transient failure stays retryable.
//
// Protocol v1.1 adds the IETF Idempotency-Key semantics on top: each entry
// stores a fingerprint of the request it answered, and a retry whose payload
// does not match gets a same-key-different-payload conflict instead of a
// replay. Retention is capacity-bounded (LRU), not time-bounded; the
// effective window is documented in docs/hub-api.md.

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

// executed: this request ran the work itself. replayed: the response was
// produced by an earlier request with the same intentId (a recorded entry or
// a joined in-flight one), signalled to the client via Idempotency-Replayed.
// mismatch: same intentId, different request payload - the caller must
// answer 422 same-key-different-payload.
export type LedgerResult =
  | { kind: "executed" | "replayed"; entry: LedgerEntry }
  | { kind: "mismatch" };

const DEFAULT_CAPACITY = 1024;

interface RecordedEntry {
  entry: LedgerEntry;
  fingerprint: string;
}

interface InFlightEntry {
  promise: Promise<LedgerEntry>;
  fingerprint: string;
}

export class IntentLedger {
  // Map preserves insertion order; re-inserting on read keeps it LRU.
  private entries = new Map<string, RecordedEntry>();
  // In-flight work keyed by intentId: check-then-act around an await would let
  // two concurrent same-id requests both miss the ledger and both dispatch, so
  // the second request awaits the first instead.
  private inFlight = new Map<string, InFlightEntry>();

  constructor(private capacity = DEFAULT_CAPACITY) {}

  // Runs work under the intentId's dedupe guarantee: a recorded outcome is
  // replayed, a concurrent request with the same id awaits the in-flight one,
  // and only a genuinely first request executes work. A same-id request whose
  // fingerprint disagrees with the recorded or in-flight one is a mismatch.
  async execute(
    intentId: string,
    fingerprint: string,
    work: () => Promise<LedgerOutcome>,
  ): Promise<LedgerResult> {
    const recorded = this.get(intentId);

    if (recorded !== null) {
      if (recorded.fingerprint !== fingerprint) {
        return { kind: "mismatch" };
      }

      return { kind: "replayed", entry: recorded.entry };
    }

    const pending = this.inFlight.get(intentId);

    if (pending !== undefined) {
      if (pending.fingerprint !== fingerprint) {
        return { kind: "mismatch" };
      }

      return { kind: "replayed", entry: await pending.promise };
    }

    const run = (async () => {
      try {
        const { entry, record } = await work();

        if (record) {
          this.record(intentId, entry, fingerprint);
        }

        return entry;
      } finally {
        this.inFlight.delete(intentId);
      }
    })();

    this.inFlight.set(intentId, { promise: run, fingerprint });
    return { kind: "executed", entry: await run };
  }

  get(intentId: string): RecordedEntry | null {
    const entry = this.entries.get(intentId);

    if (entry === undefined) {
      return null;
    }

    this.entries.delete(intentId);
    this.entries.set(intentId, entry);

    return entry;
  }

  record(intentId: string, entry: LedgerEntry, fingerprint: string): void {
    this.entries.delete(intentId);
    this.entries.set(intentId, { entry, fingerprint });

    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }
  }
}

// Order-insensitive request fingerprint: two JSON bodies with the same
// content but different key order must match, so keys are sorted recursively
// before serialization.
export function requestFingerprint(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}
