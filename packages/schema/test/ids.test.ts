import { describe, expect, test } from "bun:test";
import {
  claudeSessionId,
  cursorAgentId,
  githubItemId,
  openCodeSessionId,
  parseItemId,
  webhookId,
} from "../src";

describe("Item ids", () => {
  test("builds stable source-derived ids", () => {
    expect(githubItemId({ owner: "o", repo: "r", number: 42 })).toBe(
      "github:pr:o/r#42",
    );
    expect(cursorAgentId("agent-9")).toBe("cursor:agent:agent-9");
    expect(openCodeSessionId("sess-7")).toBe("opencode:session:sess-7");
    expect(claudeSessionId("session-123")).toBe(
      "claude-code:session:session-123",
    );
    expect(webhookId("build/agent#alpha")).toBe("webhook:build/agent#alpha");
  });

  test("parses github PR ids", () => {
    const id = githubItemId({ owner: "o", repo: "r", number: 42 });

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
