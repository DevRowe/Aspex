import type { ItemId, PreviewSpec } from "@aspex/schema";

interface PreviewSpecState {
  specs: PreviewSpec[];
}

let lastSpecs: PreviewSpec[] | null = null;
let lastSpecsByItem = new Map<ItemId, PreviewSpec[]>();

export function getSpecsByItem(
  specs: PreviewSpec[],
): Map<ItemId, PreviewSpec[]> {
  if (specs === lastSpecs) {
    return lastSpecsByItem;
  }

  const nextSpecsByItem = new Map<ItemId, PreviewSpec[]>();

  for (const spec of specs) {
    if (spec.itemId === undefined) {
      continue;
    }

    const existing = nextSpecsByItem.get(spec.itemId);

    if (existing === undefined) {
      nextSpecsByItem.set(spec.itemId, [spec]);
      continue;
    }

    existing.push(spec);
  }

  lastSpecs = specs;
  lastSpecsByItem = nextSpecsByItem;
  return nextSpecsByItem;
}

export const selectSpecsByItem = (state: PreviewSpecState) =>
  getSpecsByItem(state.specs);
