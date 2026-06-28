import { describe, expect, test } from "bun:test";
import type { ItemId } from "@aspex/schema";
import { type DirectiveAdapter, applyDirective } from "./applyDirective";

describe("applyDirective", () => {
  test("select sets the selected item", () => {
    const adapter = fakeAdapter(["one", "two"], "one");

    const result = applyDirective({ type: "select", id: "two" }, adapter);

    expect(adapter.selectedId).toBe("two");
    expect(result).toEqual({
      type: "select",
      selectedId: "two",
      changed: true,
    });
  });

  test("move advances within needs-me order and clamps at the end", () => {
    const adapter = fakeAdapter(["one", "two", "three"], "two");

    expect(applyDirective({ type: "move", delta: 1 }, adapter)).toEqual({
      type: "move",
      selectedId: "three",
      changed: true,
    });
    expect(applyDirective({ type: "move", delta: 1 }, adapter)).toEqual({
      type: "move",
      selectedId: "three",
      changed: false,
    });
    expect(adapter.selectedId).toBe("three");
  });

  test("move retreats within needs-me order and clamps at the start", () => {
    const adapter = fakeAdapter(["one", "two", "three"], "two");

    expect(applyDirective({ type: "move", delta: -1 }, adapter)).toEqual({
      type: "move",
      selectedId: "one",
      changed: true,
    });
    expect(applyDirective({ type: "move", delta: -1 }, adapter)).toEqual({
      type: "move",
      selectedId: "one",
      changed: false,
    });
  });

  test("move chooses a sensible edge when nothing is selected", () => {
    const nextAdapter = fakeAdapter(["one", "two", "three"], null);
    const previousAdapter = fakeAdapter(["one", "two", "three"], null);

    expect(applyDirective({ type: "move", delta: 1 }, nextAdapter)).toEqual({
      type: "move",
      selectedId: "one",
      changed: true,
    });
    expect(
      applyDirective({ type: "move", delta: -1 }, previousAdapter),
    ).toEqual({
      type: "move",
      selectedId: "three",
      changed: true,
    });
  });

  test("show_needs_me invokes the view affordance without changing selection", () => {
    const adapter = fakeAdapter(["one"], "one");

    const result = applyDirective({ type: "show_needs_me" }, adapter);

    expect(adapter.selectedId).toBe("one");
    expect(adapter.showCount).toBe(1);
    expect(result).toEqual({ type: "show_needs_me", changed: false });
  });

  test("open asks the adapter to open the item and reports the outcome", () => {
    const adapter = fakeAdapter(["one"], "one");

    const result = applyDirective({ type: "open", id: "one" }, adapter);

    expect(adapter.openedIds).toEqual(["one"]);
    expect(adapter.selectedId).toBe("one");
    expect(result).toEqual({ type: "open", opened: true, changed: false });
  });

  test("none is a no-op", () => {
    const adapter = fakeAdapter(["one"], "one");

    const result = applyDirective({ type: "none" }, adapter);

    expect(adapter.selectedId).toBe("one");
    expect(adapter.showCount).toBe(0);
    expect(result).toEqual({ type: "none", changed: false });
  });
});

interface FakeAdapter extends DirectiveAdapter {
  selectedId: ItemId | null;
  showCount: number;
  openedIds: ItemId[];
}

function fakeAdapter(needsMeIds: ItemId[], selectedId: ItemId | null) {
  const state: FakeAdapter = {
    selectedId,
    showCount: 0,
    openedIds: [],
    getSelectedId: () => state.selectedId,
    getNeedsMeIds: () => needsMeIds,
    setSelectedId: (id: ItemId | null) => {
      state.selectedId = id;
    },
    showNeedsMe: () => {
      state.showCount += 1;
    },
    openItem: (id: ItemId) => {
      state.openedIds.push(id);
      return true;
    },
  };

  return state;
}
