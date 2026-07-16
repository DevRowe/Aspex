import { describe, expect, test } from "bun:test";
import {
  errorMessage,
  isRecord,
  projectFromCwd,
  stringAt,
  stringField,
  trimmedStringField,
} from "../src";

describe("guards", () => {
  test("isRecord accepts plain objects and rejects arrays and null", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  test("stringField returns non-empty strings as-is", () => {
    expect(stringField("value")).toBe("value");
    expect(stringField(" padded ")).toBe(" padded ");
    expect(stringField("")).toBeUndefined();
    expect(stringField(42)).toBeUndefined();
  });

  test("trimmedStringField trims and rejects blank strings", () => {
    expect(trimmedStringField(" padded ")).toBe("padded");
    expect(trimmedStringField("   ")).toBeUndefined();
    expect(trimmedStringField(undefined)).toBeUndefined();
  });

  test("stringAt walks dotted paths in order and trims", () => {
    const payload = { error: { message: " boom " }, title: "" };

    expect(stringAt(payload, ["title", "error.message"])).toBe("boom");
    expect(stringAt(payload, ["missing.path"])).toBeUndefined();
    expect(stringAt({ a: [1] }, ["a.0"])).toBeUndefined();
  });

  test("projectFromCwd handles POSIX and Windows separators", () => {
    expect(projectFromCwd("/home/dev/aspex")).toBe("aspex");
    expect(projectFromCwd("D:\\work\\aspex")).toBe("aspex");
    expect(projectFromCwd("/")).toBe("");
  });

  test("errorMessage unwraps Error and stringifies the rest", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
