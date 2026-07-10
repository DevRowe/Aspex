import { describe, expect, test } from "bun:test";
import { openStagedItem, stageOpen } from "./openDirective";
import { item } from "./testFixtures";

describe("voice open staging", () => {
  test("stages an item without opening it", () => {
    const pending = stageOpen(
      [item({ deepLink: "https://example.test/tasks/1" })],
      "orchestrator:giles:lab-one",
    );

    expect(pending).toEqual({
      id: "orchestrator:giles:lab-one",
      label: "Owner choice needed before the worker can continue.",
      deepLink: "https://example.test/tasks/1",
    });
  });

  test("opens a staged item only through an explicit opener call", () => {
    const calls: unknown[][] = [];
    const opened = openStagedItem(
      {
        id: "orchestrator:giles:lab-one",
        label: "Task",
        deepLink: "https://example.test/tasks/1",
      },
      ((...args: unknown[]) => {
        calls.push(args);
        return {} as Window;
      }) as typeof window.open,
    );

    expect(opened).toBe(true);
    expect(calls).toEqual([
      ["https://example.test/tasks/1", "_blank", "noopener,noreferrer"],
    ]);
  });

  test("consumes the explicit open gesture when noopener returns null", () => {
    const opened = openStagedItem(
      {
        id: "orchestrator:giles:lab-one",
        label: "Task",
        deepLink: "https://example.test/tasks/1",
      },
      (() => null) as typeof window.open,
    );

    expect(opened).toBe(true);
  });
});
