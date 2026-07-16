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

  test("stages only absolute HTTP(S) links", () => {
    expect(
      stageOpen(
        [item({ deepLink: "http://example.test/tasks/1" })],
        "orchestrator:giles:lab-one",
      ),
    ).not.toBeNull();
    expect(
      stageOpen(
        [item({ deepLink: "https://example.test/tasks/1" })],
        "orchestrator:giles:lab-one",
      ),
    ).not.toBeNull();
  });

  test.each([
    "/workspace/aspex",
    "tasks/1",
    "file:///workspace/aspex",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "aspex://task/1",
    "http:example.test/tasks/1",
    "https://",
  ])("does not stage unsupported link %s", (deepLink) => {
    const pending = stageOpen(
      [item({ deepLink })],
      "orchestrator:giles:lab-one",
    );

    expect(pending).toBeNull();
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
