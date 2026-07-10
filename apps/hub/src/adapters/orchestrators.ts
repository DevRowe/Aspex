import type {
  Action,
  ActionResult,
  DispatchIntent,
  IntentAck,
  Orchestrator,
  OrchestratorId,
  StatusQueryIntent,
  StatusReport,
} from "@aspex/schema";
import { parseItemId } from "@aspex/schema";
import type { LivenessTicker } from "../engine/liveness";
import type { WorldModel } from "../world/worldModel";
import { createAdapterContext } from "./context";

// Routes `orchestrator:<orchId>:<taskId>` items' actions to the registered
// Orchestrator and carries the two referent-less verbs (dispatch,
// status-query) that POST /intents delivers. Orchestrators are a first-class
// contract distinct from Adapters (aspex-protocol-design-d1 section 2.1).
export class OrchestratorRegistry {
  private orchestrators = new Map<OrchestratorId, Orchestrator>();

  constructor(
    private world: WorldModel,
    private liveness: LivenessTicker,
  ) {}

  register(orchestrator: Orchestrator): void {
    this.orchestrators.set(orchestrator.id, orchestrator);
  }

  get(id: OrchestratorId): Orchestrator | null {
    return this.orchestrators.get(id) ?? null;
  }

  async startAll(): Promise<void> {
    await Promise.all(
      [...this.orchestrators.values()].map((orchestrator) =>
        orchestrator.start(
          createAdapterContext(this.world, this.liveness, orchestrator.id),
        ),
      ),
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.orchestrators.values()].map((orchestrator) =>
        orchestrator.stop(),
      ),
    );
  }

  // True for item ids of the form orchestrator:<orchId>:<taskId>. The boot
  // composition uses this to route /actions between adapter and orchestrator
  // registries.
  ownsItem(itemId: string): boolean {
    return parseItemId(itemId)?.source === "orchestrator";
  }

  async dispatchAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    const orchestrator = this.orchestratorForItem(itemId);

    if (orchestrator === null) {
      return { ok: false, message: "No orchestrator for item" };
    }

    const actions = orchestrator.listActions(itemId);

    if (!actions.some((action) => action.id === actionId)) {
      return { ok: false, message: "Unknown action" };
    }

    return orchestrator.runAction(itemId, actionId, payload);
  }

  actionMeta(
    itemId: string,
    actionId: string,
  ): { requiresConfirmation: boolean } | null {
    const orchestrator = this.orchestratorForItem(itemId);

    if (orchestrator === null) {
      return null;
    }

    const action = orchestrator
      .listActions(itemId)
      .find((candidate) => candidate.id === actionId);

    return action
      ? { requiresConfirmation: action.requiresConfirmation }
      : null;
  }

  listActions(itemId: string): Action[] {
    return this.orchestratorForItem(itemId)?.listActions(itemId) ?? [];
  }

  async dispatch(intent: DispatchIntent): Promise<IntentAck> {
    const orchestrator = this.orchestrators.get(intent.orchestrator) ?? null;

    if (orchestrator === null) {
      return { ok: false, message: "Unknown orchestrator" };
    }

    return orchestrator.dispatch(intent);
  }

  async query(intent: StatusQueryIntent): Promise<StatusReport> {
    const orchestrator = this.orchestratorForQuery(intent);

    if (orchestrator === null) {
      return { ok: false, text: "Unknown orchestrator" };
    }

    return orchestrator.query(intent);
  }

  private orchestratorForQuery(intent: StatusQueryIntent): Orchestrator | null {
    if (intent.orchestrator !== undefined) {
      return this.orchestrators.get(intent.orchestrator) ?? null;
    }

    // An item-scoped query names its orchestrator in the item id.
    if (intent.scope !== undefined && intent.scope !== "needs_me") {
      return this.orchestratorForItem(intent.scope);
    }

    // Whole-inbox query with no orchestrator named: unambiguous only when a
    // single orchestrator is registered.
    const all = [...this.orchestrators.values()];
    return all.length === 1 ? (all[0] ?? null) : null;
  }

  private orchestratorForItem(itemId: string): Orchestrator | null {
    const parsed = parseItemId(itemId);

    if (parsed === null || parsed.source !== "orchestrator") {
      return null;
    }

    return this.orchestrators.get(parsed.kind) ?? null;
  }
}
