import type { AttentionItem } from "@aspex/schema";

export interface PendingOpen {
  id: string;
  label: string;
  deepLink: string;
}

type OpenWindow = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

export function stageOpen(
  items: readonly AttentionItem[],
  id: string,
): PendingOpen | null {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.deepLink === undefined) {
    return null;
  }
  return { id: item.id, label: item.summary, deepLink: item.deepLink };
}

export function openStagedItem(
  pending: PendingOpen,
  openWindow: OpenWindow,
): boolean {
  return openWindow(pending.deepLink, "_blank", "noopener,noreferrer") !== null;
}
