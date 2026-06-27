# Card 08 — Hub: adapter registry + lifecycle

## Goal
A registry that holds Adapters, starts/stops them, gives each an `AdapterContext` (so `emit` → world-model and `heartbeat` → liveness), routes an action to the adapter that owns the Item, and answers "what does this action require" for the HTTP layer.

## Depends on
- Card 02 (Adapter interface), Card 04 (world-model + bus), Card 06 (liveness ticker/heartbeat).

## Files to create
```
apps/hub/src/adapters/registry.ts
apps/hub/test/registry.test.ts
```

## Interfaces / stubs

```ts
import type { Adapter, AdapterContext, ActionResult } from "@aspex/schema";
import type { WorldModel } from "../world/worldModel";
import type { LivenessTicker } from "../engine/liveness";

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  constructor(private world: WorldModel, private liveness: LivenessTicker) {}

  register(a: Adapter): void { this.adapters.set(a.id, a); }

  async startAll(): Promise<void> {
    // build an AdapterContext per adapter:
    //   emit(signal)       -> this.world.applySignal(signal)
    //   heartbeat(source)  -> refresh staleAfter for that source's items via liveness
    //   log(msg)           -> console.log(`[${a.id}] ${msg}`)
  }
  async stopAll(): Promise<void> {}

  // itemId -> owning adapter (source is the first ":"-segment of the id).
  private adapterForItem(itemId: string): Adapter | null { /* parse source, map source->adapter id */ }

  async dispatchAction(itemId: string, actionId: string, payload?: unknown): Promise<ActionResult> { /* find adapter, runAction */ }
  actionMeta(itemId: string, actionId: string): { requiresConfirmation: boolean } | null { /* from adapter.listActions */ }
}
```

> Source→adapter mapping: `github`→`github`, `claude-code`→`claude-code`, `webhook`→`webhook`, `codex`→`codex`. Keep a small constant map.

## Steps
1. Implement `register`, `startAll` (build context, call `adapter.start(ctx)`), `stopAll`.
2. Implement `adapterForItem` using `parseItemId` from `@aspex/schema`.
3. Implement `dispatchAction` and `actionMeta` (the latter feeds card 07's `actionMeta`).
4. Test with a **fake adapter** that records calls.

## Acceptance check
```bash
bun test apps/hub/test/registry.test.ts   # green
```
Tests must prove:
- A registered fake adapter's `start` receives a context; calling `ctx.emit(signal)` lands the Item in the world-model.
- `dispatchAction("github:pr:o/r#1", "approve")` routes to the github fake adapter's `runAction`.
- `actionMeta` returns the action's `requiresConfirmation`.
- An action for an unknown source → graceful `{ ok:false }`, not a crash.

## Out of scope / do NOT do
- Do not implement any real adapter here (cards 10, 15–18). Only the registry + a fake test adapter.
- Do not start HTTP here (card 07/09).
