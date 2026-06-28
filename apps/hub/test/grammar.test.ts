import { describe, expect, test } from "bun:test";
import type { Action, Intent, ItemId, VoiceSession } from "@aspex/schema";
import { type ParseInput, parse } from "../src/voice/grammar";

const selectedId: ItemId = "github:pr:brocorp/aspex#25";
const threshold = 0.8;

const allActions = [
  action("approve"),
  action("rerun"),
  action("merge", { requiresConfirmation: true, risk: "dangerous" }),
  action("comment"),
  action("request_changes"),
];

function baseInput(overrides: Partial<ParseInput> = {}): ParseInput {
  return {
    transcript: { text: "what needs me", confidence: 0.95 },
    context: { selectedId, needsMeIds: [selectedId] },
    session: {},
    selectedActions: allActions,
    resolveProject: (name) =>
      name === "atlas" ? "github:pr:atlas/core#1" : null,
    confidenceThreshold: threshold,
    ...overrides,
  };
}

function parseText(
  text: string,
  overrides: Partial<Omit<ParseInput, "transcript">> = {},
): Intent {
  return parse(
    baseInput({ transcript: { text, confidence: 0.95 }, ...overrides }),
  );
}

function action(id: string, overrides: Partial<Action> = {}): Action {
  return {
    id,
    label: id,
    risk: "safe",
    requiresConfirmation: false,
    ...overrides,
  };
}

describe("parse", () => {
  test.each([
    ["what needs me", { kind: "nav", directive: { type: "show_needs_me" } }],
    [
      "show what needs me",
      { kind: "nav", directive: { type: "show_needs_me" } },
    ],
    [
      "focus atlas",
      {
        kind: "nav",
        directive: { type: "select", id: "github:pr:atlas/core#1" },
      },
    ],
    ["next", { kind: "nav", directive: { type: "move", delta: 1 } }],
    ["previous", { kind: "nav", directive: { type: "move", delta: -1 } }],
    ["read it", { kind: "read", target: selectedId }],
    ["read this", { kind: "read", target: selectedId }],
    ["open it", { kind: "open", target: selectedId }],
    ["open this", { kind: "open", target: selectedId }],
    ["approve", { kind: "action", itemId: selectedId, actionId: "approve" }],
    ["re-run", { kind: "action", itemId: selectedId, actionId: "rerun" }],
    [
      "re-run checks",
      { kind: "action", itemId: selectedId, actionId: "rerun" },
    ],
    ["merge", { kind: "action", itemId: selectedId, actionId: "merge" }],
    ["cancel", { kind: "cancel" }],
    ["never mind", { kind: "cancel" }],
    ["comment", { kind: "dictate", itemId: selectedId, actionId: "comment" }],
    [
      "request changes",
      { kind: "dictate", itemId: selectedId, actionId: "request_changes" },
    ],
    [
      "reject",
      { kind: "dictate", itemId: selectedId, actionId: "request_changes" },
    ],
  ] satisfies Array<[string, Intent]>)(
    "parses grammar row %p",
    (spoken, expected) => {
      expect(parseText(spoken)).toEqual(expected);
    },
  );

  test.each([
    ["post it", { kind: "post" }],
    ["send it", { kind: "post" }],
    ["cancel", { kind: "cancel" }],
    ["never mind", { kind: "cancel" }],
  ] satisfies Array<[string, Intent]>)(
    "parses dictation mode control row %p",
    (spoken, expected) => {
      expect(
        parseText(spoken, {
          session: { dictating: { itemId: selectedId, actionId: "comment" } },
        }),
      ).toEqual(expected);
    },
  );

  test("normalizes case, whitespace, and trailing punctuation for commands", () => {
    expect(parseText("  APPROVE!!!  ")).toEqual({
      kind: "action",
      itemId: selectedId,
      actionId: "approve",
    });
    expect(parseText("show   what   needs   me?")).toEqual({
      kind: "nav",
      directive: { type: "show_needs_me" },
    });
  });

  test("applies the confidence gate before every action output", () => {
    expect(
      parse(
        baseInput({
          transcript: { text: "approve", confidence: threshold - 0.01 },
          session: { dictating: { itemId: selectedId, actionId: "comment" } },
        }),
      ),
    ).toEqual({
      kind: "no_match",
      heard: "approve",
      reason: "low_confidence",
    });
  });

  test("dictation mode treats non-control speech as verbatim body", () => {
    expect(
      parseText("merge the database", {
        session: { dictating: { itemId: selectedId, actionId: "comment" } },
      }),
    ).toEqual({ kind: "dictation_body", text: "merge the database" });
  });

  test("confirms only a matching pending action", () => {
    const session: VoiceSession = {
      pendingConfirm: {
        itemId: selectedId,
        actionId: "merge",
        label: "Merge",
        armedAt: "2026-06-28T00:00:00.000Z",
      },
    };

    expect(parseText("confirm merge", { session })).toEqual({
      kind: "confirm",
      itemId: selectedId,
      actionId: "merge",
    });
    expect(parseText("confirm approve", { session })).toEqual({
      kind: "no_match",
      heard: "confirm approve",
      reason: "unknown_command",
    });
  });

  test("confirm merge without pending confirm is unknown_command", () => {
    expect(parseText("confirm merge")).toEqual({
      kind: "no_match",
      heard: "confirm merge",
      reason: "unknown_command",
    });
  });

  test("covers every no_match reason", () => {
    expect(
      parse(baseInput({ transcript: { text: "approve", confidence: 0.1 } })),
    ).toEqual({
      kind: "no_match",
      heard: "approve",
      reason: "low_confidence",
    });
    expect(parseText("blah blah")).toEqual({
      kind: "no_match",
      heard: "blah blah",
      reason: "unknown_command",
    });
    expect(parseText("approve", { context: { needsMeIds: [] } })).toEqual({
      kind: "no_match",
      heard: "approve",
      reason: "no_referent",
    });
    expect(
      parseText("merge", { selectedActions: [action("approve")] }),
    ).toEqual({
      kind: "no_match",
      heard: "merge",
      reason: "action_unavailable",
    });
    expect(
      parseText("focus atlas", { resolveProject: () => "ambiguous" }),
    ).toEqual({
      kind: "no_match",
      heard: "focus atlas",
      reason: "ambiguous",
    });
  });

  test("focus reports no_referent when the injected resolver misses", () => {
    expect(parseText("focus missing")).toEqual({
      kind: "no_match",
      heard: "focus missing",
      reason: "no_referent",
    });
  });

  test("unknown high-confidence text never returns an action kind", () => {
    const intent = parseText("blah blah");

    expect(intent.kind).toBe("no_match");
    expect(intent.kind).not.toBe("action");
    expect(intent.kind).not.toBe("confirm");
    expect(intent.kind).not.toBe("dictate");
  });
});
