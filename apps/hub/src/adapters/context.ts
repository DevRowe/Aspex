import type { AdapterContext } from "@aspex/schema";
import type { LivenessTicker } from "../engine/liveness";
import type { WorldModel } from "../world/worldModel";

// One AdapterContext implementation shared by source adapters and
// orchestrators: emit upserts the world-model, heartbeat refreshes liveness
// for every item of the source, log is namespaced by the owner id.
export function createAdapterContext(
  world: WorldModel,
  liveness: LivenessTicker,
  ownerId: string,
): AdapterContext {
  return {
    emit: (signal) => world.applySignal(signal),
    heartbeat: (source) => applyHeartbeat(world, liveness, source),
    log: (msg) => console.log(`[${ownerId}] ${msg}`),
  };
}

function applyHeartbeat(
  world: WorldModel,
  liveness: LivenessTicker,
  source: string,
): void {
  const before = world.snapshot();
  const after = liveness.heartbeat(source, before);

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
      world.updateItem(updated);
    }
  }
}
