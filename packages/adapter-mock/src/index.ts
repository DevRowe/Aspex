import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
  Signal,
} from "@aspex/schema";
import { assertSignal } from "@aspex/schema";

export interface MockScriptEntry {
  atMs: number;
  signal: Signal;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (fn: () => void, delayMs: number) => TimeoutHandle;
type ClearTimeoutFn = (timer: TimeoutHandle) => void;

export interface MockAdapterOptions {
  script?: MockScriptEntry[];
  setTimeout?: SetTimeoutFn;
  clearTimeout?: ClearTimeoutFn;
}

const HEARTBEAT_INITIAL_DELAY_MS = 120;
const HEARTBEAT_INTERVAL_MS = 120;
const STOP_EMITTING_DEMO_IDS = new Set(["claude-code:session:liveness-demo"]);

export class MockAdapter implements Adapter {
  id = "mock";
  private timers: TimeoutHandle[] = [];
  private actionsByItem = new Map<string, Action[]>();
  private script: MockScriptEntry[] | null;
  private setTimer: SetTimeoutFn;
  private clearTimer: ClearTimeoutFn;

  constructor(options: MockAdapterOptions = {}) {
    this.script = options.script ?? null;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
  }

  async start(ctx: AdapterContext): Promise<void> {
    await this.stop();

    const script = this.script ?? (await loadDefaultScript());
    const orderedScript = [...script].sort((a, b) => a.atMs - b.atMs);

    for (const entry of orderedScript) {
      if (!Number.isInteger(entry.atMs) || entry.atMs < 0) {
        throw new Error("Mock script atMs must be a non-negative integer");
      }

      assertSignal(entry.signal);
    }

    this.actionsByItem.clear();

    for (const entry of orderedScript) {
      if (entry.signal.actions !== undefined) {
        this.actionsByItem.set(entry.signal.id, entry.signal.actions);
      }

      this.timers.push(
        this.setTimer(() => {
          ctx.emit(entry.signal);
        }, entry.atMs),
      );
    }

    scheduleWorkingHeartbeats(ctx, this, orderedScript);
    ctx.log(`scheduled ${orderedScript.length} mock Signals`);
  }

  listActions(itemId: string): Action[] {
    return this.actionsByItem.get(itemId) ?? [];
  }

  async runAction(
    itemId: string,
    actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    if (!this.listActions(itemId).some((action) => action.id === actionId)) {
      return { ok: false, message: "Unknown mock action" };
    }

    return { ok: true, message: "mock action" };
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      this.clearTimer(timer);
    }

    this.timers = [];
  }

  schedule(fn: () => void, delayMs: number): void {
    this.timers.push(this.setTimer(fn, delayMs));
  }
}

function scheduleWorkingHeartbeats(
  ctx: AdapterContext,
  adapter: MockAdapter,
  script: MockScriptEntry[],
): void {
  for (let index = 0; index < script.length; index += 1) {
    const entry = script[index];

    if (
      entry === undefined ||
      entry.signal.state !== "working" ||
      STOP_EMITTING_DEMO_IDS.has(entry.signal.id)
    ) {
      continue;
    }

    const stopAt = nextSignalAt(script, index);
    const untilMs =
      stopAt ?? entry.atMs + HEARTBEAT_INITIAL_DELAY_MS + HEARTBEAT_INTERVAL_MS;

    for (
      let atMs = entry.atMs + HEARTBEAT_INITIAL_DELAY_MS;
      atMs < untilMs;
      atMs += HEARTBEAT_INTERVAL_MS
    ) {
      adapter.schedule(() => {
        ctx.heartbeat(entry.signal.source);
      }, atMs);
    }
  }
}

function nextSignalAt(
  script: MockScriptEntry[],
  currentIndex: number,
): number | null {
  const current = script[currentIndex];

  if (current === undefined) {
    return null;
  }

  const next = script
    .slice(currentIndex + 1)
    .find((entry) => entry.signal.id === current.signal.id);

  return next?.atMs ?? null;
}

async function loadDefaultScript(): Promise<MockScriptEntry[]> {
  const scriptUrl = new URL(
    "../../../examples/mock-events/script.json",
    import.meta.url,
  );
  const raw = await Bun.file(scriptUrl).json();

  if (!Array.isArray(raw)) {
    throw new Error("Mock script must be an array");
  }

  return raw.map((entry) => {
    if (!isScriptEntry(entry)) {
      throw new Error("Invalid mock script entry");
    }

    return entry;
  });
}

function isScriptEntry(value: unknown): value is MockScriptEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "atMs" in value &&
    typeof value.atMs === "number" &&
    "signal" in value &&
    typeof value.signal === "object" &&
    value.signal !== null
  );
}
