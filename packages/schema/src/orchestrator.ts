import type { ActionResult, Adapter, AdapterContext } from "./adapter";
import { isRecord } from "./guards";
import type { Action, ItemId } from "./types";

// An Orchestrator is a bidirectional peer that OWNS agents, distinct from an
// Adapter (an observed source). It reuses the two data primitives that make
// the Hub reusable - Signals in via start()/ctx.emit, Actions on items - so
// the world-model, ranking, liveness, SSE, and voice all work unchanged.
// dispatch/query are the only net-new methods: the two direction verbs with
// no pre-existing item to target (ADR: aspex-protocol-design-d1 section 2.1).

// The Source discriminator's second segment, e.g. "giles" in
// `orchestrator:giles:<taskId>`.
export type OrchestratorId = string;

export interface Orchestrator {
  id: OrchestratorId;

  // INGEST: poll (or subscribe to) the orchestrator's team state and emit
  // AttentionItem Signals via ctx.emit.
  start(ctx: AdapterContext): Promise<void>;

  // ITEM-SCOPED DIRECTION: the verbs that target an existing task. Matches
  // Adapter so the registry routes POST /actions to the orchestrator with no
  // server change.
  listActions(itemId: ItemId): Action[];
  runAction(
    itemId: ItemId,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult>;

  // REFERENT-LESS DIRECTION: the two verbs with no target item.
  dispatch(intent: DispatchIntent): Promise<IntentAck>;
  query(intent: StatusQueryIntent): Promise<StatusReport>;

  stop(): Promise<void>;
}

export interface DispatchIntent {
  verb: "dispatch";
  // Client-generated UUID; idempotency key. The Hub dedupes repeats and the
  // reference adapter reuses it as the delivery-inbox filename, so a retried
  // dispatch cannot spawn a second worker.
  intentId: string;
  orchestrator: OrchestratorId;
  // Hint; the orchestrator may resolve it itself.
  project?: string;
  // The dictated task.
  instruction: string;
  // Two-step confirm: the Hub refuses an unconfirmed dispatch with 409.
  confirmed?: boolean;
}

export interface StatusQueryIntent {
  verb: "status_query";
  intentId: string;
  // Omitted = ask every orchestrator / answer from Hub state.
  orchestrator?: OrchestratorId;
  // Whole inbox, or one task's detail.
  scope?: "needs_me" | ItemId;
}

export type DirectionIntent = DispatchIntent | StatusQueryIntent;

export interface IntentAck {
  ok: boolean;
  acceptedId?: ItemId;
  message?: string;
}

// Spoken/rendered summary.
export interface StatusReport {
  ok: boolean;
  text: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// intentIds become filenames in the orchestrator's delivery inbox, so the
// accepted alphabet is deliberately hostile to path tricks: no separators, no
// leading dot, bounded length.
export function isValidIntentId(x: unknown): x is string {
  return typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x);
}

export function isValidDispatchIntent(x: unknown): x is DispatchIntent {
  return (
    isRecord(x) &&
    x.verb === "dispatch" &&
    isValidIntentId(x.intentId) &&
    isNonEmptyString(x.orchestrator) &&
    isNonEmptyString(x.instruction) &&
    (x.project === undefined || isNonEmptyString(x.project)) &&
    (x.confirmed === undefined || typeof x.confirmed === "boolean")
  );
}

export function isValidStatusQueryIntent(x: unknown): x is StatusQueryIntent {
  return (
    isRecord(x) &&
    x.verb === "status_query" &&
    isValidIntentId(x.intentId) &&
    (x.orchestrator === undefined || isNonEmptyString(x.orchestrator)) &&
    (x.scope === undefined || isNonEmptyString(x.scope))
  );
}

export function isValidDirectionIntent(x: unknown): x is DirectionIntent {
  return isValidDispatchIntent(x) || isValidStatusQueryIntent(x);
}

export function assertDirectionIntent(
  x: unknown,
): asserts x is DirectionIntent {
  if (!isValidDirectionIntent(x)) {
    throw new Error("Invalid DirectionIntent");
  }
}

// Compile-time proof that every Orchestrator can stand in for an Adapter on
// the item-scoped surface (start/listActions/runAction/stop).
type _OrchestratorCoversAdapter = Orchestrator extends Adapter ? true : never;
const _covers: _OrchestratorCoversAdapter = true;
void _covers;
