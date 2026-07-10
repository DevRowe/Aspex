import type { AttentionItem } from "@aspex/schema";
import type { RankedState } from "./domain";

export class LabWorldModel {
  private state: RankedState | null = null;
  private selectedId: string | undefined;
  private listeners = new Set<() => void>();

  apply(next: RankedState): void {
    this.state = next;
    const items = this.orderedItems();
    if (!items.some((item) => item.id === this.selectedId)) {
      this.selectedId = items[0]?.id;
    }
    this.emit();
  }

  snapshot(): RankedState | null {
    return this.state;
  }

  orderedItems(): AttentionItem[] {
    if (this.state === null) {
      return [];
    }
    return [
      ...this.state.needsMe,
      ...this.state.overflow,
      ...this.state.ambient,
    ];
  }

  selected(): AttentionItem | undefined {
    return this.orderedItems().find((item) => item.id === this.selectedId);
  }

  selectedIndex(): number {
    const index = this.orderedItems().findIndex(
      (item) => item.id === this.selectedId,
    );
    return Math.max(0, index);
  }

  select(id: string): void {
    if (this.orderedItems().some((item) => item.id === id)) {
      this.selectedId = id;
      this.emit();
    }
  }

  move(delta: 1 | -1): void {
    const items = this.orderedItems();
    if (items.length === 0) {
      return;
    }
    const next = (this.selectedIndex() + delta + items.length) % items.length;
    this.selectedId = items[next]?.id;
    this.emit();
  }

  needsMeIds(): string[] {
    return this.state?.needsMe.map((item) => item.id) ?? [];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
