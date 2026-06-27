# Card 04 — Hub: in-process bus + world-model service

## Goal
The heart of the Hub: a typed in-process event bus and a **WorldModel** service that applies incoming Signals by **upsert** (ADR-0001), persists via the store, and emits a **diff** event whenever Items change. Derivation of `reason`/`attentionRequired` (card 05) and `liveness` (card 06) is injected, so this card has no circular dependency on them.

## Depends on
- Card 02 (schema), Card 03 (store).

## Files to create
```
apps/hub/src/bus.ts                 # typed event emitter
apps/hub/src/world/worldModel.ts    # applySignal, snapshot, diff emit
apps/hub/test/worldModel.test.ts
```

## Interfaces / stubs

**`bus.ts`** — a tiny typed emitter (use Node's `EventEmitter` under the hood, Bun-compatible):
```ts
export type HubEvents = {
  "world:changed": { upserted: import("@aspex/schema").AttentionItem[]; removed: string[] };
};
export class Bus {
  on<K extends keyof HubEvents>(k: K, fn: (e: HubEvents[K]) => void): void {}
  emit<K extends keyof HubEvents>(k: K, e: HubEvents[K]): void {}
}
```

**`worldModel.ts`**:
```ts
import type { AttentionItem, Signal } from "@aspex/schema";
import type { ItemStore } from "../store/itemStore";
import type { Bus } from "../bus";

// Injected derivers — real versions come from cards 05 & 06; default to identity.
export interface Derivers {
  deriveAttention: (item: AttentionItem) => AttentionItem; // sets reason/attentionRequired (card 05)
  deriveLiveness: (item: AttentionItem) => AttentionItem;  // sets liveness/staleAfter (card 06)
}

export class WorldModel {
  constructor(
    private store: ItemStore,
    private bus: Bus,
    private derivers: Derivers,
  ) {}

  // Apply one Signal: merge onto existing Item (or create), set observedAt=now,
  // run derivers, upsert to store, emit world:changed with the single upserted Item.
  applySignal(signal: Signal): void { /* ... */ }

  snapshot(): AttentionItem[] { return this.store.getAll(); }

  remove(id: string): void { /* store.remove + emit removed */ }
}
```

## Steps
1. Implement `Bus` wrapping `EventEmitter`.
2. Implement `applySignal`:
   - `const existing = store.get(signal.id)`.
   - `const merged = { ...defaultsFor(signal), ...existing, ...signal, observedAt: new Date().toISOString() }` — note Signal fields win over existing (latest report), but keep prior `evidence`/`actions` if the Signal omits them. Be explicit about which fields a Signal may overwrite.
   - `const derived = derivers.deriveLiveness(derivers.deriveAttention(merged))`.
   - `store.upsert(derived)`; `bus.emit("world:changed", { upserted: [derived], removed: [] })`.
3. `defaultsFor` fills required fields a brand-new Item needs (e.g. `liveness: "live"`, `attentionRequired: false`, `severity: "info"`, `reason: "ambient"`, `evidence: []`, `actions: []`, `staleAfter` = now + 5min placeholder).
4. Tests with stub derivers (identity) + in-memory store.

## Acceptance check
```bash
bun test apps/hub/test/worldModel.test.ts   # green
```
Tests must prove:
- Applying two Signals with the **same id** → `snapshot()` has **one** Item; later field values win (ADR-0001).
- Each `applySignal` emits exactly one `world:changed` with that Item in `upserted`.
- A Signal that omits `evidence`/`actions` does not wipe previously stored ones.

## Out of scope / do NOT do
- Do **not** implement ranking or real liveness here — inject stubs. (Cards 05, 06.)
- Do not expose HTTP (card 07) or talk to adapters (card 08).
- Do not keep a separate in-memory copy that can drift from the store — the store is the source of truth (ADR-0005); read through it.
