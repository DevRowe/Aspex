import { describe, expect, test } from "bun:test";
import {
  type Intent,
  assertVoiceContext,
  isDirective,
  isValidVoiceContext,
} from "../src";

describe("voice schema", () => {
  test("validates VoiceContext shape", () => {
    expect(isValidVoiceContext({ needsMeIds: ["github:pr:o/r#1"] })).toBe(true);
    expect(isValidVoiceContext({ needsMeIds: "x" })).toBe(false);
  });

  test("assertVoiceContext throws for invalid context", () => {
    expect(() => assertVoiceContext({ needsMeIds: "x" })).toThrow(
      "Invalid VoiceContext",
    );
  });

  test("narrows ClientDirective values", () => {
    expect(isDirective({ type: "select", id: "x" })).toBe(true);
    expect(isDirective({ type: "nope" })).toBe(false);
  });

  test("Intent remains a discriminated union", () => {
    const x: Intent = {
      kind: "no_match",
      heard: "blah",
      reason: "unknown_command",
    };

    expect(x.kind).toBe("no_match");

    // @ts-expect-error bogus Intent kind should fail type checking.
    const bad: Intent = { kind: "bogus" };
    void bad;
  });
});
