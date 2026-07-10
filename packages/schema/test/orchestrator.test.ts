import { describe, expect, test } from "bun:test";
import {
  assertDirectionIntent,
  isValidDirectionIntent,
  isValidDispatchIntent,
  isValidIntentId,
  isValidSignal,
  isValidStatusQueryIntent,
  orchestratorItemId,
  parseItemId,
} from "../src";

// Example payloads from the approved protocol design
// (aspex-protocol-design-d1 sections 2.3 and 2.4).
const DISPATCH_INTENT = {
  verb: "dispatch",
  intentId: "b1e6-dispatch-11",
  orchestrator: "giles",
  project: "numbat",
  instruction:
    "Add a settings screen to toggle background music, persisted locally.",
  confirmed: true,
};

const STATUS_QUERY_INTENT = {
  verb: "status_query",
  intentId: "b1e6-status-03",
  scope: "needs_me",
};

describe("orchestrator item ids", () => {
  test("builds orchestrator:<orchId>:<taskId> ids the generic parser understands", () => {
    const id = orchestratorItemId("giles", "numbat-tracing-g3");

    expect(id).toBe("orchestrator:giles:numbat-tracing-g3");
    expect(parseItemId(id)).toEqual({
      source: "orchestrator",
      kind: "giles",
      rest: "numbat-tracing-g3",
    });
  });

  test("orchestrator is a valid Signal source", () => {
    expect(
      isValidSignal({
        id: orchestratorItemId("giles", "numbat-pack-batch-p3"),
        source: "orchestrator",
        state: "blocked",
      }),
    ).toBe(true);
  });
});

describe("intent id validation", () => {
  test("accepts UUID-like ids", () => {
    expect(isValidIntentId("b1e6a1c2-answer-07")).toBe(true);
    expect(isValidIntentId("B1.e6_x")).toBe(true);
  });

  test("rejects path tricks, separators, and unbounded length", () => {
    expect(isValidIntentId("../escape")).toBe(false);
    expect(isValidIntentId(".hidden")).toBe(false);
    expect(isValidIntentId("a/b")).toBe(false);
    expect(isValidIntentId("a\\b")).toBe(false);
    expect(isValidIntentId("")).toBe(false);
    expect(isValidIntentId("x".repeat(200))).toBe(false);
    expect(isValidIntentId(42)).toBe(false);
  });
});

describe("direction intent validation", () => {
  test("accepts the design's dispatch example", () => {
    expect(isValidDispatchIntent(DISPATCH_INTENT)).toBe(true);
    expect(isValidDirectionIntent(DISPATCH_INTENT)).toBe(true);
  });

  test("accepts the design's status-query example", () => {
    expect(isValidStatusQueryIntent(STATUS_QUERY_INTENT)).toBe(true);
    expect(isValidDirectionIntent(STATUS_QUERY_INTENT)).toBe(true);
  });

  test("status-query orchestrator and scope are optional", () => {
    expect(
      isValidStatusQueryIntent({ verb: "status_query", intentId: "q-1" }),
    ).toBe(true);
    expect(
      isValidStatusQueryIntent({
        verb: "status_query",
        intentId: "q-2",
        orchestrator: "giles",
        scope: "orchestrator:giles:numbat-pack-batch-p3",
      }),
    ).toBe(true);
  });

  test("rejects dispatch without orchestrator or instruction", () => {
    expect(
      isValidDispatchIntent({ ...DISPATCH_INTENT, orchestrator: undefined }),
    ).toBe(false);
    expect(
      isValidDispatchIntent({ ...DISPATCH_INTENT, instruction: "  " }),
    ).toBe(false);
    expect(
      isValidDispatchIntent({ ...DISPATCH_INTENT, intentId: "../../etc" }),
    ).toBe(false);
  });

  test("rejects unknown verbs", () => {
    expect(isValidDirectionIntent({ verb: "merge", intentId: "x-1" })).toBe(
      false,
    );
  });

  test("assertDirectionIntent throws on invalid payloads", () => {
    expect(() => assertDirectionIntent({ verb: "dispatch" })).toThrow(
      "Invalid DirectionIntent",
    );
    expect(() => assertDirectionIntent(DISPATCH_INTENT)).not.toThrow();
  });
});
