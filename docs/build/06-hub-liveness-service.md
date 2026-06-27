# Card 06 — Hub: liveness service (two-track decay)

## Goal
Implement two-track liveness (ADR-0003): polled sources decay on **poll health**, push sources decay on **heartbeat freshness**, and **terminal states never decay**. Pure decay math + a ticker that re-evaluates Items on a timer and emits diffs for any whose liveness changed.

## Depends on
- Card 02 (schema), Card 04 (bus + world-model).

## Files to create
```
apps/hub/src/engine/liveness.ts
apps/hub/test/liveness.test.ts
```

## Key rules (from ADR-0003)
- **Terminal states** (`done`, `error` after a confirmed stop) → always `live`. Never decay.
- **Polled sources** (github): a successful poll cycle calls `heartbeat("github")`, which refreshes `staleAfter` for that source's Items. If polls fail, Items decay because nothing refreshes them.
- **Push sources** (claude-code): every `PostToolUse` heartbeat refreshes `staleAfter` for that session. Silence → decay.
- Decay ladder by how long past `staleAfter`: `live` → (`quiet` after grace) → (`stale`) → (`lost`).

## Interfaces / stubs

```ts
import type { AttentionItem, Liveness, Source, State } from "@aspex/schema";

const TERMINAL: State[] = ["done"]; // error handled per ADR-0002 as attention, not decay
const POLLED: Source[] = ["github"];

export interface LivenessConfig {
  pollGraceMs: number;       // e.g. 90_000  (poll interval * ~1.5)
  heartbeatGraceMs: number;  // e.g. 120_000 (PostToolUse gaps during long tool runs)
  quietAfterMs: number;      // past staleAfter -> quiet
  staleAfterMs: number;      // further -> stale
  lostAfterMs: number;       // further -> lost
}

// Compute staleAfter for an Item given when it was last refreshed.
export function nextStaleAfter(source: Source, state: State, observedAtIso: string, cfg: LivenessConfig): string {
  // terminal -> far future; polled -> observedAt + pollGraceMs; push -> observedAt + heartbeatGraceMs
}

// Pure: what liveness should this Item have at time `now`?
export function livenessAt(item: AttentionItem, now: number, cfg: LivenessConfig): Liveness {
  // terminal state -> "live".
  // overdue = now - Date.parse(item.staleAfter)
  // overdue <= 0 -> "live"; < quiet -> "quiet"; < stale -> "stale"; else "lost".
}
```

**`LivenessTicker`** (the only stateful part):
```ts
export class LivenessTicker {
  constructor(private getItems: () => AttentionItem[], private onChange: (i: AttentionItem) => void, private cfg: LivenessConfig) {}
  start(intervalMs = 10_000): void { /* setInterval: recompute livenessAt for each; if changed, onChange(updatedItem) */ }
  stop(): void {}
  // Called by adapters via AdapterContext.heartbeat(source) -> refresh staleAfter for that source's live Items.
  heartbeat(source: string, items: AttentionItem[]): AttentionItem[] { /* return items with refreshed staleAfter */ }
}
```

## Steps
1. Implement `nextStaleAfter` and `livenessAt` (pure).
2. Wire `nextStaleAfter` into the world-model's `deriveLiveness` (card 08 wiring) so every applied Signal gets a correct `staleAfter` + initial `liveness`.
3. Implement `LivenessTicker`; on each tick, for any Item whose computed liveness differs from stored, call `onChange` (which re-applies it via the world-model so a `world:changed` diff fires).
4. Tests for the pure functions.

## Acceptance check
```bash
bun test apps/hub/test/liveness.test.ts   # green
```
Tests must prove:
- A `working` push-source Item whose `staleAfter` is in the past → `quiet`/`stale`/`lost` by elapsed time.
- A freshly-polled github Item (observedAt = now) → `live`, even if its underlying object is old (poll-health semantics, ADR-0003).
- A `done` Item with `staleAfter` far in the past → **still `live`** (terminal never decays).
- `heartbeat("claude-code", ...)` pushes `staleAfter` forward so the Item returns to `live`.

## Out of scope / do NOT do
- No HTTP, no real timers in tests (call `livenessAt(now)` directly with controlled `now`).
- Do not change an Item's `state` here — liveness is orthogonal to state (ADR-0003). Only `liveness`/`staleAfter` change.
- Do not decay terminal states. This is the cardinal rule.
