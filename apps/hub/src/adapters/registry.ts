import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
} from "@aspex/schema";
import { parseItemId } from "@aspex/schema";
import type { LivenessTicker } from "../engine/liveness";
import type { WorldModel } from "../world/worldModel";

const sourceToAdapterId: Record<string, string> = {
  github: "github",
  "claude-code": "claude-code",
  webhook: "webhook",
  codex: "codex",
  opencode: "opencode",
  cursor: "cursor",
};

const observeOnlyNoActionAdapters = new Set(["codex", "opencode", "cursor"]);

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  constructor(
    private world: WorldModel,
    private liveness: LivenessTicker,
  ) {}

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  async startAll(): Promise<void> {
    await Promise.all(
      [...this.adapters.values()].map((adapter) =>
        adapter.start(this.contextFor(adapter)),
      ),
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.stop()),
    );
  }

  private adapterForItem(itemId: string): Adapter | null {
    const source = sourceForItem(itemId);

    if (source === null) {
      return null;
    }

    const adapterId = sourceToAdapterId[source];

    if (adapterId === undefined) {
      return null;
    }

    return this.adapters.get(adapterId) ?? this.demoMockAdapter();
  }

  async dispatchAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult> {
    const adapter = this.adapterForItem(itemId);

    if (adapter === null) {
      return { ok: false, message: "No adapter for item source" };
    }

    const actions = adapter.listActions(itemId);

    if (actions.length === 0 && observeOnlyNoActionAdapters.has(adapter.id)) {
      return adapter.runAction(itemId, actionId, payload);
    }

    if (!this.hasAction(actions, actionId)) {
      return { ok: false, message: "Unknown action" };
    }

    return adapter.runAction(itemId, actionId, payload);
  }

  actionMeta(
    itemId: string,
    actionId: string,
  ): { requiresConfirmation: boolean } | null {
    const adapter = this.adapterForItem(itemId);

    if (adapter === null) {
      return null;
    }

    const action = adapter.listActions(itemId).find((a) => a.id === actionId);

    return action
      ? { requiresConfirmation: action.requiresConfirmation }
      : null;
  }

  private contextFor(adapter: Adapter): AdapterContext {
    return {
      emit: (signal) => this.world.applySignal(signal),
      heartbeat: (source) => this.heartbeat(source),
      log: (msg) => console.log(`[${adapter.id}] ${msg}`),
    };
  }

  private heartbeat(source: string): void {
    const before = this.world.snapshot();
    const after = this.liveness.heartbeat(source, before);

    for (let i = 0; i < after.length; i += 1) {
      const current = before[i];
      const updated = after[i];

      if (
        current !== undefined &&
        updated !== undefined &&
        current.id === updated.id &&
        current.source === source &&
        (current.staleAfter !== updated.staleAfter ||
          current.liveness !== updated.liveness)
      ) {
        this.world.updateItem(updated);
      }
    }
  }

  private hasAction(actions: Action[], actionId: string): boolean {
    return actions.some((action) => action.id === actionId);
  }

  private demoMockAdapter(): Adapter | null {
    return this.adapters.get("mock") ?? null;
  }
}

function sourceForItem(itemId: string): string | null {
  const parsed = parseItemId(itemId);

  if (parsed !== null) {
    return parsed.source;
  }

  const webhookPrefix = "webhook:";
  const webhookKey = itemId.slice(webhookPrefix.length);

  if (
    itemId.startsWith(webhookPrefix) &&
    webhookKey.length > 0 &&
    !webhookKey.startsWith(":")
  ) {
    return "webhook";
  }

  return null;
}
