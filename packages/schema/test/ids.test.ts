import { describe, expect, test } from "bun:test";
import { claudeSessionId, githubPrId, parseItemId, webhookId } from "../src";

describe("Item ids", () => {
  test("builds stable source-derived ids", () => {
    expect(githubPrId("o/r", 42)).toBe("github:pr:o/r#42");
    expect(claudeSessionId("session-123")).toBe(
      "claude-code:session:session-123",
    );
    expect(webhookId("build/agent#alpha")).toBe("webhook:build/agent#alpha");
  });

  test("parses github PR ids", () => {
    const id = githubPrId("o/r", 42);

    expect(parseItemId(id)).toEqual({
      source: "github",
      kind: "pr",
      rest: "o/r#42",
    });
  });

  test("parses on the first two separators only", () => {
    expect(parseItemId("github:pr:o/r#42:ci:failed")).toEqual({
      source: "github",
      kind: "pr",
      rest: "o/r#42:ci:failed",
    });
  });

  test("returns null for malformed ids", () => {
    expect(parseItemId("github")).toBeNull();
    expect(parseItemId("github:pr:")).toBeNull();
    expect(parseItemId(":pr:o/r#42")).toBeNull();
    expect(parseItemId("github::o/r#42")).toBeNull();
  });
});
