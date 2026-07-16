import { describe, expect, test } from "bun:test";
import { item, ranked } from "./testFixtures";
import { LabWorldModel } from "./worldModel";

describe("LabWorldModel", () => {
  test("applies full ranked updates while preserving selection by stable item id", () => {
    const model = new LabWorldModel();
    const second = item({
      id: "orchestrator:giles:lab-two",
      summary: "Second",
    });
    model.apply(ranked({ needsMe: [item(), second] }));
    model.select(second.id);
    model.apply(ranked({ needsMe: [second, item({ summary: "Updated" })] }));
    expect(model.selected()?.id).toBe(second.id);
    expect(model.orderedItems().map((entry) => entry.summary)).toEqual([
      "Second",
      "Updated",
    ]);
  });

  test("moves through needs-me, overflow, and ambient as one bounded carousel", () => {
    const model = new LabWorldModel();
    model.apply(
      ranked({
        needsMe: [item({ id: "one" })],
        overflow: [item({ id: "two" })],
        ambient: [
          item({ id: "three", attentionRequired: false, reason: "ambient" }),
        ],
      }),
    );
    model.move(1);
    expect(model.selected()?.id).toBe("two");
    model.move(-1);
    expect(model.selected()?.id).toBe("one");
  });
});
