# Card 14 — Web: liveness rendering (never silently wrong)

## Goal
Make liveness visible and honest (ADR-0003 / the "a silently-wrong dashboard is worse than none" rule). Each Item shows its `state` and `liveness` distinctly, including the composite "working · stale", with a last-seen relative time.

## Depends on
- Card 12 (cards render), Card 06 (Items carry `liveness`/`staleAfter`/`observedAt`).

## Files to create / edit
```
apps/web/src/components/LivenessChip.tsx   (new)
apps/web/src/components/ItemCard.tsx        (edit: use LivenessChip)
apps/web/src/lib/format.ts                  (edit: relativeTime)
```

## Visual mapping
| liveness | treatment |
|---|---|
| `live` | normal opacity, subtle "live" dot |
| `quiet` | slightly dimmed, "quiet" |
| `stale` | dimmed + "stale" tag + "last seen 4m ago" |
| `lost` | heavily dimmed + "lost — last seen 12m ago" + the state shown as *unconfirmed* |

- Always render **state AND liveness** together, e.g. `working · stale`. Never show state alone (that's the silent-wrong trap).
- `relativeTime(observedAt)` → "just now / 3m ago / 1h ago".
- Terminal `done` Items read `done · live` (confirmed-final, never decays — ADR-0003).

## Steps
1. `LivenessChip` mapping liveness→treatment + last-seen.
2. Edit `ItemCard` to compose `state · liveness` + chip.
3. `relativeTime` helper.

## Acceptance check
With `hub --mock` (which includes a session that stops heart-beating, case 6 in card 10):
- That session visibly transitions `working · live` → `working · quiet` → `working · stale` → `working · lost` over time, with the last-seen time growing.
- A freshly-polled-style github Item stays `live` even though its underlying object is old (poll-health semantics).
- The `done` session reads `done · live` and never decays.

## Out of scope / do NOT do
- Do not compute liveness on the client — render exactly what the Hub sends (ADR-0003 owns the logic).
- Do not hide stale/lost Items — surfacing uncertainty IS the feature.
