import type { ClientDirective, ItemId } from "@aspex/schema";
import { useStore } from "../store";

export interface DirectiveAdapter {
  getSelectedId: () => ItemId | null;
  getNeedsMeIds: () => ItemId[];
  setSelectedId: (id: ItemId | null) => void;
  showNeedsMe?: () => void;
  openItem?: (id: ItemId) => boolean;
}

export type DirectiveApplyResult =
  | { type: "select"; selectedId: ItemId; changed: boolean }
  | { type: "move"; selectedId: ItemId | null; changed: boolean }
  | { type: "show_needs_me"; changed: false }
  | { type: "open"; opened: boolean; changed: false }
  | { type: "none"; changed: false };

export function applyDirective(
  directive: ClientDirective | undefined,
  adapter: DirectiveAdapter = appStoreDirectiveAdapter(),
): DirectiveApplyResult {
  if (!directive || directive.type === "none") {
    return { type: "none", changed: false };
  }

  if (directive.type === "select") {
    const previous = adapter.getSelectedId();
    adapter.setSelectedId(directive.id);
    return {
      type: "select",
      selectedId: directive.id,
      changed: previous !== directive.id,
    };
  }

  if (directive.type === "show_needs_me") {
    adapter.showNeedsMe?.();
    return { type: "show_needs_me", changed: false };
  }

  if (directive.type === "open") {
    const opened = adapter.openItem?.(directive.id) ?? false;
    return { type: "open", opened, changed: false };
  }

  const needsMeIds = adapter.getNeedsMeIds();
  if (needsMeIds.length === 0) {
    return { type: "move", selectedId: null, changed: false };
  }

  const previous = adapter.getSelectedId();
  const currentIndex = previous ? needsMeIds.indexOf(previous) : -1;
  const nextIndex =
    currentIndex === -1
      ? directive.delta > 0
        ? 0
        : needsMeIds.length - 1
      : clamp(currentIndex + directive.delta, 0, needsMeIds.length - 1);
  const selectedId = needsMeIds[nextIndex] ?? null;

  if (selectedId) {
    adapter.setSelectedId(selectedId);
  }

  return {
    type: "move",
    selectedId,
    changed: previous !== selectedId,
  };
}

function appStoreDirectiveAdapter(): DirectiveAdapter {
  return {
    getSelectedId: () => useStore.getState().selectedId,
    getNeedsMeIds: () => useStore.getState().needsMe.map((item) => item.id),
    setSelectedId: (id) => useStore.getState().setSelectedId(id),
    showNeedsMe: focusNeedsMe,
    openItem: openItemDeepLink,
  };
}

function openItemDeepLink(id: ItemId): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { needsMe, overflow, ambient } = useStore.getState();
  const item = [...needsMe, ...overflow, ...ambient].find(
    (candidate) => candidate.id === id,
  );

  if (!item?.deepLink) {
    return false;
  }

  window.open(item.deepLink, "_blank", "noopener,noreferrer");
  return true;
}

function focusNeedsMe(): void {
  if (typeof document === "undefined") {
    return;
  }

  const section = document.querySelector<HTMLElement>(
    '[data-voice-section="needs-me"]',
  );
  section?.scrollIntoView({ block: "start", behavior: "smooth" });
  section?.focus({ preventScroll: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
