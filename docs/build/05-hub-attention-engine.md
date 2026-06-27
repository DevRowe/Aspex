# Card 05 — Hub: attention engine (ranking + ownership)

## Goal
Pure functions that (a) **enforce attention ownership** (ADR-0002) so one unit of work never glows twice, and (b) **rank** the needs-me list by the priority ladder with a cap, splitting Ambient out. No I/O — all pure and table-tested.

## Depends on
- Card 02 (schema).

## Files to create
```
apps/hub/src/engine/attention.ts
apps/hub/test/attention.test.ts
```

## Interfaces / stubs

```ts
import type { AttentionItem, Reason } from "@aspex/schema";

// Lower number = higher priority (top of needs-me).
export const RUNG: Record<Reason, number> = {
  blocked_on_human: 1,
  failing_ci: 2,
  review_requested: 3,
  awaiting_merge: 4,
  ambient: 99,
};

// ADR-0002 guard. Adapters SET reason/attentionRequired; this clamps them so the
// ownership rule holds even if an adapter misbehaves.
export function enforceOwnership(item: AttentionItem): AttentionItem {
  // Per-agent sources (claude-code, codex): attentionRequired ONLY for blocked/error.
  //   -> done/working => attentionRequired=false, reason="ambient".
  //   -> blocked => reason "blocked_on_human"; error => reason "blocked_on_human" (top band) w/ severity high.
  // github: attentionRequired only for failing_ci | review_requested | awaiting_merge.
  // Anything not attentionRequired => reason "ambient".
  // Return a NEW object (do not mutate input).
}

export interface RankedView {
  needsMe: AttentionItem[];   // attentionRequired, sorted, capped
  overflow: AttentionItem[];  // attentionRequired beyond the cap
  ambient: AttentionItem[];   // the rest
}

export function rank(items: AttentionItem[], cap: number): RankedView {
  // 1. attention = items.filter(i => i.attentionRequired)
  // 2. sort by RUNG[reason] asc, then severity desc (high>medium>low>info),
  //    then observedAt desc (newest first).
  // 3. needsMe = first `cap`; overflow = rest.
  // 4. ambient = items.filter(i => !i.attentionRequired) sorted by observedAt desc.
}
```

## Steps
1. Implement `enforceOwnership` exactly per ADR-0002 (see `../adr/0002-*`).
2. Implement a `severityRank` helper (`high`=3 … `info`=0).
3. Implement `rank`.
4. Wire `enforceOwnership` as the `deriveAttention` injected into `WorldModel` (done in card 08 wiring; just export it here).
5. Write table-driven tests for the grilled scenarios.

## Acceptance check
```bash
bun test apps/hub/test/attention.test.ts   # green
```
Tests must prove (the scenarios from the grill):
- A github PR that is BOTH `review_requested` and `failing_ci` is **one** Item, ranked on the **higher** rung (`failing_ci`, rung 2), carrying both actions — never two cards.
- A claude-code Item with `state: "done"` → `attentionRequired === false`, `reason === "ambient"`, lands in `ambient`, never in `needsMe` (ADR-0002).
- A claude-code Item with `state: "blocked"` → rung 1, top of `needsMe`.
- `rank` with cap=2 over 4 attention items → `needsMe.length === 2`, `overflow.length === 2`.
- Tie-break: two rung-3 items order by severity then recency.

## Out of scope / do NOT do
- No database, HTTP, or liveness here.
- Do not invent new `reason` values — use the five in the schema.
- Do not let Ambient items ever appear in `needsMe`.
