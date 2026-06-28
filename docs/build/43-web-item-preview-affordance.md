# Card 43 — Web: Item "Preview" affordance

## Goal
On an Item that has a **bound trusted preview spec**, show a "Preview" affordance that opens the Deck focused on that Preview (booting it if needed) — implemented purely as a **client-side cross-reference** of the spec list's `itemId` against rendered Items. `AttentionItem` is **not** modified (ADR-0015).

## Depends on
- Card 42 (Deck + `previewClient` + preview store slice), Card 13 (Item detail / actions UI), Card 36 (types), Card 12 (selection).

## Files to create
```
apps/web/src/preview/specsByItem.ts     # memoized itemId -> PreviewSpec[] from the store
```
## Files to edit
```
apps/web/src/components/ItemDetail.tsx   # (or the card-13 actions component) add the affordance
```

## Behaviour
- From the loaded spec list (card 42 store), build `specsByItem: Map<ItemId, PreviewSpec[]>`.
- For the rendered/selected Item: if a **trusted** spec binds to its `id`, render a **Preview** button alongside the Deep-link/actions. Click → if a live Preview for that spec exists, focus it in the Deck; else `POST /previews {specId}` then focus. Reuses card 42's client/store — **no new endpoints**.
- If only an **untrusted** spec binds → show a disabled "Preview" with a *"pixels lane not yet available"* tooltip. If no spec binds → render nothing.
- The whole affordance is absent when `previews.enabled` is false.

## Steps
1. `specsByItem` selector (memoized over the spec-list store slice).
2. Add the Preview button to the Item detail/actions, gated on a bound trusted spec.
3. Wire the click → focus-or-boot-then-focus via card 42's store/client + navigate to the Deck.
4. Tests `apps/web/test/preview/itemAffordance.*`: Item with a bound trusted spec shows Preview; Item with none shows nothing; Item with only an untrusted spec shows the disabled hint; click boots + focuses (mock fetch).

## Acceptance check
With the `engine=mock` Hub, a demo spec whose `itemId` matches a demo Item, and `bun run dev`:
- The Item shows a **Preview** affordance; clicking it opens the Deck and the tile boots to `ready`.
- An Item with no bound spec shows no affordance.

## Out of scope / do NOT do
- **Do NOT add any field to `AttentionItem`/`types.ts`** (ADR-0015) — cross-reference only.
- No adapter changes (ADR-0014 — adapter-surfaced specs are a future [[Provision]]).
- No auto-boot on render/selection — explicit click only (guardrail 15).
- No new HTTP endpoints — reuse card 41's surface.
