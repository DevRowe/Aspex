import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Action,
  ActionResult,
  AdapterContext,
  DispatchIntent,
  IntentAck,
  Orchestrator,
  Signal,
  StatusQueryIntent,
  StatusReport,
} from "@aspex/schema";
import { parseItemId } from "@aspex/schema";
import { type GilesInboxIntent, writeIntentFile } from "./inbox";
import {
  type GilesTaskSnapshot,
  mapDepartedGilesTask,
  mapGilesTask,
} from "./map";
import {
  type GilesWorkerState,
  isValidGilesTaskId,
  lastStatusEvent,
  parseBacklogInFlight,
  parseMeta,
  parseWorkerStateLine,
} from "./state";

// The reference Orchestrator (aspex-protocol-design-d1 section 3): state IN
// by polling Giles's files READ-ONLY (backlog + meta + the authoritative
// bin/giles-worker-state.sh), direction OUT by writing intent files into the
// designated Giles-side inbox. Aspex never touches a project; every mutation
// still happens through Giles's own sanctioned helpers.

export interface GilesOrchestratorOptions {
  // The Giles home directory (contains data/, state/, bin/).
  home: string;
  pollIntervalMs?: number;
  // Injectable process runner for tests; argv is exec'd directly, no shell.
  exec?: ExecFn;
  setInterval?: SetIntervalFn;
  clearInterval?: ClearIntervalFn;
  now?: () => Date;
}

export type ExecFn = (argv: string[]) => Promise<{
  exitCode: number;
  stdout: string;
}>;

type IntervalHandle = ReturnType<typeof setInterval>;
type SetIntervalFn = (fn: () => void, delayMs: number) => IntervalHandle;
type ClearIntervalFn = (timer: IntervalHandle) => void;

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const ITEM_SCOPED_VERBS = new Set([
  "approve",
  "deny",
  "answer",
  "redirect",
  "ship",
] as const);

type ItemScopedVerb = "approve" | "deny" | "answer" | "redirect" | "ship";

export class GilesOrchestrator implements Orchestrator {
  id = "giles";
  private readonly home: string;
  private readonly pollIntervalMs: number;
  private readonly exec: ExecFn;
  private readonly setTimer: SetIntervalFn;
  private readonly clearTimer: ClearIntervalFn;
  private readonly now: () => Date;
  private timer: IntervalHandle | null = null;
  private running = false;
  private readonly actionsByItem = new Map<string, Action[]>();
  private readonly knownTaskIds = new Set<string>();

  constructor(options: GilesOrchestratorOptions) {
    this.home = options.home;
    this.pollIntervalMs = Math.max(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS,
    );
    this.exec = options.exec ?? bunExec;
    this.setTimer = options.setInterval ?? setInterval;
    this.clearTimer = options.clearInterval ?? clearInterval;
    this.now = options.now ?? (() => new Date());
  }

  async start(ctx: AdapterContext): Promise<void> {
    await this.stop();
    await this.poll(ctx);
    this.timer = this.setTimer(() => {
      void this.poll(ctx);
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  listActions(itemId: string): Action[] {
    return this.actionsByItem.get(itemId) ?? [];
  }

  async runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    const taskId = this.taskIdFor(itemId);

    if (taskId === null) {
      return { ok: false, message: "Not a giles orchestrator item" };
    }

    if (actionId === "status") {
      const report = await this.taskStatusText(taskId);
      return { ok: true, message: report };
    }

    if (!isItemScopedVerb(actionId)) {
      return { ok: false, message: "Unknown action" };
    }

    const body = isRecord(payload) ? payload : {};
    const intent: GilesInboxIntent = {
      intentId:
        typeof body.intentId === "string" ? body.intentId : randomUUID(),
      verb: actionId,
      targetTaskId: taskId,
      ...(typeof body.text === "string" && body.text.trim() !== ""
        ? { text: body.text }
        : {}),
      confirmedAt: this.now().toISOString(),
      origin: "aspex-hub",
    };

    try {
      const result = await writeIntentFile(this.home, intent);
      return {
        ok: true,
        message: result.written
          ? `Queued ${actionId} for giles (${intent.intentId})`
          : `Already queued (${intent.intentId})`,
      };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async dispatch(intent: DispatchIntent): Promise<IntentAck> {
    const file: GilesInboxIntent = {
      intentId: intent.intentId,
      verb: "dispatch",
      targetTaskId: null,
      ...(intent.project !== undefined ? { project: intent.project } : {}),
      instruction: intent.instruction,
      confirmedAt: this.now().toISOString(),
      origin: "aspex-hub",
    };

    try {
      const result = await writeIntentFile(this.home, file);
      return {
        ok: true,
        message: result.written
          ? "Dispatched to giles; the new task will appear in the stream."
          : `Already dispatched (${intent.intentId})`,
      };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async query(intent: StatusQueryIntent): Promise<StatusReport> {
    const scope = intent.scope;

    if (scope !== undefined && scope !== "needs_me") {
      const taskId =
        this.taskIdFor(scope) ?? (isValidGilesTaskId(scope) ? scope : null);

      if (taskId === null) {
        return { ok: false, text: "Unknown task" };
      }

      return { ok: true, text: await this.taskStatusText(taskId) };
    }

    const refs = parseBacklogInFlight(
      await this.readHomeFile("data/backlog.md"),
    );

    if (refs.length === 0) {
      return { ok: true, text: "No giles tasks in flight." };
    }

    const lines = refs.map((ref) => `${ref.taskId}: ${ref.title}`);
    return {
      ok: true,
      text: `${refs.length} in flight. ${lines.join(" | ")}`,
    };
  }

  async poll(ctx: AdapterContext): Promise<Signal[]> {
    if (this.running) {
      return [];
    }

    this.running = true;

    try {
      const refs = parseBacklogInFlight(
        await this.readHomeFile("data/backlog.md"),
      );
      const signals: Signal[] = [];

      for (const ref of refs) {
        const snapshot = await this.snapshotTask(ref.taskId, ref);
        const signal = mapGilesTask(this.id, snapshot);

        if (signal.actions !== undefined) {
          this.actionsByItem.set(signal.id, signal.actions);
        }

        this.knownTaskIds.add(ref.taskId);
        signals.push(signal);
        ctx.emit(signal);
      }

      // Tasks that left `## In flight` (merged / torn down) get one terminal
      // Signal so they decay out of the world-model.
      const currentIds = new Set(refs.map((ref) => ref.taskId));

      for (const taskId of this.knownTaskIds) {
        if (currentIds.has(taskId)) {
          continue;
        }

        const departed = mapDepartedGilesTask(this.id, taskId);
        this.actionsByItem.set(departed.id, []);
        this.knownTaskIds.delete(taskId);
        signals.push(departed);
        ctx.emit(departed);
      }

      ctx.heartbeat("orchestrator");
      ctx.log(`polled ${refs.length} giles in-flight tasks`);

      return signals;
    } catch (error) {
      ctx.log(`giles poll failed: ${errorMessage(error)}`);

      return [];
    } finally {
      this.running = false;
    }
  }

  private async snapshotTask(
    taskId: string,
    ref: GilesTaskSnapshot["ref"],
  ): Promise<GilesTaskSnapshot> {
    const metaText = await this.readHomeFile(`state/${taskId}.meta`);
    const statusText = await this.readHomeFile(`state/${taskId}.status`);

    return {
      ref,
      workerState: await this.workerState(taskId),
      meta: parseMeta(metaText),
      lastStatus: lastStatusEvent(statusText),
    };
  }

  // Authoritative current-state read. The status log is an append-only event
  // log and is never tailed for state (Giles AGENTS.md section 8).
  private async workerState(taskId: string): Promise<GilesWorkerState> {
    const script = join(this.home, "bin/giles-worker-state.sh");

    if (!existsSync(script)) {
      return {
        state: "unknown",
        source: "none",
        detail: "state helper missing",
      };
    }

    try {
      const result = await this.exec([script, taskId]);
      const parsed = parseWorkerStateLine(result.stdout);

      if (result.exitCode !== 0 || parsed === null) {
        return {
          state: "unknown",
          source: "none",
          detail: `unreadable worker state (exit ${result.exitCode})`,
        };
      }

      return parsed;
    } catch (error) {
      return { state: "unknown", source: "none", detail: errorMessage(error) };
    }
  }

  private async taskStatusText(taskId: string): Promise<string> {
    const state = await this.workerState(taskId);
    const detail = state.detail === "" ? "" : ` - ${state.detail}`;

    return `${taskId}: ${state.state}${detail}`;
  }

  private taskIdFor(itemId: string): string | null {
    const parsed = parseItemId(itemId);

    if (
      parsed === null ||
      parsed.source !== "orchestrator" ||
      parsed.kind !== this.id ||
      !isValidGilesTaskId(parsed.rest)
    ) {
      return null;
    }

    return parsed.rest;
  }

  private async readHomeFile(relativePath: string): Promise<string> {
    const path = join(this.home, relativePath);

    if (!existsSync(path)) {
      return "";
    }

    return readFile(path, "utf8");
  }
}

const bunExec: ExecFn = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout };
};

function isItemScopedVerb(actionId: string): actionId is ItemScopedVerb {
  return ITEM_SCOPED_VERBS.has(actionId as ItemScopedVerb);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from "./inbox";
export * from "./map";
export * from "./state";
