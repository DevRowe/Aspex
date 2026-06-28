import { describe, expect, test } from "bun:test";
import {
  type FreeformConfig,
  type IntentResult,
  isIntentResult,
  parseFreeformConfig,
} from "../src";

describe("intent schema", () => {
  test("parses a valid free-form config", () => {
    expect(
      parseFreeformConfig({
        enabled: true,
        endpoints: ["http://127.0.0.1:11434"],
        model: "llama3.1",
        timeoutMs: 5000,
        elevateConfirm: true,
      }),
    ).toEqual({
      enabled: true,
      endpoints: ["http://127.0.0.1:11434"],
      model: "llama3.1",
      timeoutMs: 5000,
      elevateConfirm: true,
    });
  });

  test("rejects enabled free-form config with empty endpoints", () => {
    expect(() =>
      parseFreeformConfig({
        enabled: true,
        endpoints: [],
      }),
    ).toThrow("Invalid FreeformConfig");
  });

  test("accepts disabled free-form config without endpoints", () => {
    expect(parseFreeformConfig({ enabled: false })).toEqual({
      enabled: false,
      endpoints: [],
      model: "llama3.1",
      timeoutMs: 5000,
      elevateConfirm: true,
    });
  });

  test("defaults elevateConfirm to true", () => {
    expect(
      parseFreeformConfig({
        enabled: true,
        endpoints: ["http://127.0.0.1:11434"],
      }).elevateConfirm,
    ).toBe(true);
  });

  test("rejects unknown free-form config keys", () => {
    expect(() =>
      parseFreeformConfig({
        enabled: false,
        prompt: "do what I mean",
      }),
    ).toThrow("Invalid FreeformConfig");
  });

  test("narrows first-stage free-form IntentResult values", () => {
    const result: unknown = {
      intent: {
        kind: "action",
        itemId: "github:pr:o/r#1",
        actionId: "approve",
      },
      source: "freeform",
    };

    expect(isIntentResult(result)).toBe(true);

    if (isIntentResult(result)) {
      const narrowed: IntentResult = result;
      expect(narrowed.intent.kind).toBe("action");
    }
  });

  test("rejects a bare Intent without free-form provenance", () => {
    expect(
      isIntentResult({
        kind: "no_match",
        heard: "approve the atlas PR",
        reason: "unknown_command",
      }),
    ).toBe(false);
  });

  test("rejects non-first-stage free-form IntentResult values", () => {
    expect(
      isIntentResult({
        intent: {
          kind: "confirm",
          itemId: "github:pr:o/r#1",
          actionId: "approve",
        },
        source: "freeform",
      }),
    ).toBe(false);
  });

  test("FreeformConfig keeps required fields concrete", () => {
    const config: FreeformConfig = parseFreeformConfig(undefined);

    expect(config.enabled).toBe(false);
    expect(config.timeoutMs).toBe(5000);
  });
});
