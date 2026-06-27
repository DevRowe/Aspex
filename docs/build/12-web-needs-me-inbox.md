# Card 12 — Web: needs-me inbox (the core screen)

## Goal
Render the ranked needs-me list as **calm-by-default** cards, capped with "show more", and an Ambient section below. This is the screen that answers "what needs me?".

## Depends on
- Card 11 (scaffold + store).

## Files to create
```
apps/web/src/components/Inbox.tsx
apps/web/src/components/ItemCard.tsx
apps/web/src/components/ReasonBadge.tsx
apps/web/src/components/AmbientList.tsx
apps/web/src/lib/format.ts        # reason labels, relative time
```

## Visual rules (calm-by-default)
- Default look is **quiet**: neutral background, no red/glow unless severity warrants. The list earns attention by being short and ranked, not loud.
- Card shows: ReasonBadge, `summary`, `project` (and `actor` if present), a liveness chip (placeholder until card 14), and the top action label (full actions in card 13 detail).
- Order is exactly the order the Hub sent (already ranked — do **not** re-sort on the client).
- Needs-me is already capped by the Hub (`needsMe`); render `overflow` behind a "Show N more" toggle.
- Ambient below, visually de-emphasised and collapsed by default.

## Reason → label/accent (in `format.ts`)
```ts
export const reasonLabel = { blocked_on_human:"Blocked — needs you", failing_ci:"CI failing", review_requested:"Review requested", awaiting_merge:"Ready to merge", ambient:"" } as const;
// accent: blocked_on_human & failing_ci -> warm; review_requested & awaiting_merge -> neutral-positive; ambient -> muted.
```

## Stub
```tsx
export function Inbox() {
  const { needsMe, overflow, ambient } = useStore();
  // <section "What needs me"> map needsMe -> <ItemCard>; if empty -> calm "Nothing needs you right now."
  // <ShowMore count={overflow.length}> -> reveals overflow
  // <AmbientList items={ambient}/>
}
```

## Steps
1. Build `ReasonBadge`, `ItemCard`, `Inbox`, `AmbientList`.
2. Empty needs-me → a calm reassuring empty state (not a sad/error state).
3. Wire `Inbox` into `App`.
4. Selecting a card sets a `selectedId` (store field) — detail panel is card 13.

## Acceptance check
With `hub --mock` running and `bun run dev`:
- The grilled scenarios render correctly: the **review-requested + failing-CI PR is ONE card** under "CI failing" (higher rung), not two.
- The **done** session is in **Ambient**, never in needs-me.
- The **blocked** session is at the **top** of needs-me.
- With cap=7 and >7 attention items, a "Show more" reveals the rest.
- Empty needs-me shows the calm empty state.

(Add a Playwright/DOM test if available, else a documented manual check + a unit test of `format.ts`.)

## Out of scope / do NOT do
- No action buttons / confirm flow (card 13). Top action is display-only here.
- No real liveness styling (card 14) — a placeholder chip is fine.
- Do NOT re-rank or filter on the client — trust the Hub's order (single source of truth).
