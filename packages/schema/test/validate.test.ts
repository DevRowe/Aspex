import { describe, expect, test } from "bun:test";
import { assertSignal, githubItemId, isValidSignal } from "../src";

describe("Signal validation", () => {
  test("accepts a minimal valid Signal", () => {
    expect(
      isValidSignal({
        id: githubItemId({ owner: "o", repo: "r", number: 42 }),
        source: "github",
        state: "needs_review",
      }),
    ).toBe(true);
  });

  test("rejects invalid source and state values", () => {
    expect(
      isValidSignal({
        id: githubItemId({ owner: "o", repo: "r", number: 42 }),
        source: "nope",
        state: "x",
      }),
    ).toBe(false);
  });

  test("assertSignal throws for invalid Signals", () => {
    expect(() =>
      assertSignal({
        id: githubItemId({ owner: "o", repo: "r", number: 42 }),
        source: "nope",
        state: "x",
      }),
    ).toThrow("Invalid Signal");
  });
});
