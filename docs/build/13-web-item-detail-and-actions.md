# Card 13 — Web: Item detail + actions (with safe confirm)

## Goal
Clicking a card opens a detail view showing evidence and **risk-tiered actions**. Safe actions are one click; dangerous actions need a typed two-step confirm. Read-only Items (claude-code, ADR-0004) show a **deep-link**, not action buttons.

## Depends on
- Card 12 (selection), Card 07 (`POST /actions`), Card 02 (Action/risk).

## Files to create
```
apps/web/src/components/ItemDetail.tsx
apps/web/src/components/ActionButton.tsx
apps/web/src/components/ConfirmGate.tsx
```

## Behaviour
- Detail panel/drawer for `selectedId`: `summary`, `evidence` (links open externally; text shown inline), and actions.
- **Action risk tiers:**
  - `safe` → single click → `runAction(id, actionId)`.
  - `medium` → single click but a brief "are you sure?" inline affordance.
  - `dangerous` (`requiresConfirmation`) → **two-step**: click reveals a `ConfirmGate` requiring the user to type the confirm word (e.g. the action label or `CONFIRM`) before the real `runAction(id, actionId, /*confirmed*/ true)` fires. This is the Phase-0 stand-in for the voice confirm-phrase (Phase 1).
- **Read-only Items** (`actions` empty, `deepLink` present) → render an "Open" / "Focus terminal" link to `deepLink`. No action buttons. (claude-code is read-only in Phase 0 — ADR-0004.)
- After an action returns, show its `ActionResult.message` (toast/inline) and let the next SSE `state` update reflect the change. Do not optimistically mutate the store.

## Stub
```tsx
export function ItemDetail({ item }: { item: AttentionItem }) {
  // evidence list
  // if item.actions.length === 0 && item.deepLink -> <a href={item.deepLink}>Open</a>
  // else actions.map(a => a.requiresConfirmation ? <ConfirmGate action={a} .../> : <ActionButton action={a} .../>)
}
```

## Steps
1. Build `ActionButton` (safe/medium) and `ConfirmGate` (dangerous typed confirm).
2. Build `ItemDetail`; render deep-link branch for read-only items.
3. Wire selection from `Inbox` → `ItemDetail`.
4. Surface `ActionResult.message`.

## Acceptance check
With `hub --mock`:
- Clicking the **awaiting-merge** PR shows a **merge** action that is `dangerous`: clicking it does NOT immediately POST; it requires typing the confirm word first; only then does `POST /actions/.../merge` fire with `confirmed:true` (verify the 409-without-confirm path is never hit from the UI).
- The **blocked claude-code** Item shows a **deep-link only**, no action buttons.
- A `safe` action (e.g. comment) POSTs on a single click.

## Out of scope / do NOT do
- Do not implement voice confirm (Phase 1). Typed/click confirm only.
- Do not enable any claude-code write action (no PTY — ADR-0004). Deep-link is the only affordance.
- Do not optimistically update the world-model; let the Hub be the source of truth.
