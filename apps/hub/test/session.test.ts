import { describe, expect, test } from "bun:test";
import type { Intent, ItemId, VoiceSession } from "@aspex/schema";
import { type ReduceMeta, reduce } from "../src/voice/session";

const itemId: ItemId = "github:pr:brocorp/aspex#26";
const now = Date.parse("2026-06-28T04:00:00.000Z");
const confirmTtlMs = 30_000;

function meta(overrides: Partial<ReduceMeta> = {}): ReduceMeta {
  return {
    now,
    confirmTtlMs,
    requiresConfirmation: (_itemId, actionId) => actionId === "merge",
    actionLabel: (_itemId, actionId) =>
      actionId === "merge" ? "Merge" : actionId,
    ...overrides,
  };
}

function armedSession(
  overrides: Partial<NonNullable<VoiceSession["pendingConfirm"]>> = {},
) {
  return {
    pendingConfirm: {
      itemId,
      actionId: "merge",
      label: "Merge",
      armedAt: new Date(now).toISOString(),
      ...overrides,
    },
  } satisfies VoiceSession;
}

describe("reduce", () => {
  test("confirmable merge action arms and does not dispatch", () => {
    const result = reduce(
      {},
      { kind: "action", itemId, actionId: "merge" },
      meta(),
    );

    expect(result).toEqual({
      next: {
        pendingConfirm: {
          itemId,
          actionId: "merge",
          label: "Merge",
          armedAt: "2026-06-28T04:00:00.000Z",
        },
      },
      effect: { kind: "armed", itemId, actionId: "merge", label: "Merge" },
    });
    expect(result.effect.kind).not.toBe("dispatch");
  });

  test("matching confirm dispatches and clears pendingConfirm", () => {
    const result = reduce(
      armedSession(),
      { kind: "confirm", itemId, actionId: "merge" },
      meta(),
    );

    expect(result).toEqual({
      next: {},
      effect: { kind: "dispatch", itemId, actionId: "merge" },
    });
    expect(result.effect).not.toHaveProperty("confirmed");
  });

  test("mismatched confirm noMatches and clears pendingConfirm", () => {
    expect(
      reduce(
        armedSession(),
        { kind: "confirm", itemId, actionId: "approve" },
        meta(),
      ),
    ).toEqual({
      next: {},
      effect: { kind: "noMatch", reason: "unknown_command" },
    });
  });

  test("confirm with no pending returns noMatch", () => {
    expect(
      reduce({}, { kind: "confirm", itemId, actionId: "merge" }, meta()),
    ).toEqual({
      next: {},
      effect: { kind: "noMatch", reason: "unknown_command" },
    });
  });

  test("expired pendingConfirm plus confirm returns noMatch", () => {
    const session = armedSession({
      armedAt: new Date(now - confirmTtlMs - 1).toISOString(),
    });

    expect(
      reduce(session, { kind: "confirm", itemId, actionId: "merge" }, meta()),
    ).toEqual({
      next: {},
      effect: { kind: "noMatch", reason: "unknown_command" },
    });
  });

  test("non-confirmable approve dispatches immediately", () => {
    const result = reduce(
      armedSession(),
      { kind: "action", itemId, actionId: "approve" },
      meta(),
    );

    expect(result).toEqual({
      next: {},
      effect: { kind: "dispatch", itemId, actionId: "approve" },
    });
    expect(result.effect).not.toHaveProperty("confirmed");
  });

  test("dictation flow prompts, reads back, and posts body", () => {
    const prompt = reduce(
      armedSession(),
      { kind: "dictate", itemId, actionId: "comment" },
      meta(),
    );

    expect(prompt).toEqual({
      next: { dictating: { itemId, actionId: "comment" } },
      effect: { kind: "dictation_prompt", itemId, actionId: "comment" },
    });

    const readback = reduce(
      prompt.next,
      { kind: "dictation_body", text: "looks good" },
      meta(),
    );

    expect(readback).toEqual({
      next: {
        dictating: {
          itemId,
          actionId: "comment",
          pendingBody: "looks good",
        },
      },
      effect: {
        kind: "dictation_readback",
        itemId,
        actionId: "comment",
        body: "looks good",
      },
    });

    const post = reduce(readback.next, { kind: "post" }, meta());

    expect(post).toEqual({
      next: {},
      effect: {
        kind: "dispatch",
        itemId,
        actionId: "comment",
        payload: { body: "looks good" },
      },
    });
    expect(post.effect).not.toHaveProperty("confirmed");
  });

  test("post without a dictated body noMatches and abandons pending confirm", () => {
    expect(reduce(armedSession(), { kind: "post" }, meta())).toEqual({
      next: {},
      effect: { kind: "noMatch", reason: "unknown_command" },
    });
  });

  test("cancel clears pending confirm and dictation", () => {
    const session: VoiceSession = {
      ...armedSession(),
      dictating: {
        itemId,
        actionId: "comment",
        pendingBody: "looks good",
      },
    };

    expect(reduce(session, { kind: "cancel" }, meta())).toEqual({
      next: {},
      effect: { kind: "cancelled" },
    });
  });

  test("recognized nav while confirm armed clears confirm, no_match retains it", () => {
    const session = armedSession();
    const navIntent: Intent = {
      kind: "nav",
      directive: { type: "show_needs_me" },
    };

    expect(reduce(session, navIntent, meta())).toEqual({
      next: {},
      effect: {
        kind: "navigate",
        directive: { type: "show_needs_me" },
      },
    });

    expect(
      reduce(
        session,
        { kind: "no_match", heard: "mumble", reason: "unknown_command" },
        meta(),
      ),
    ).toEqual({
      next: session,
      effect: {
        kind: "noMatch",
        reason: "unknown_command",
        heard: "mumble",
      },
    });
  });

  test("recognized read and open while confirm armed clear confirm", () => {
    expect(
      reduce(armedSession(), { kind: "read", target: itemId }, meta()),
    ).toEqual({
      next: {},
      effect: { kind: "read", target: itemId },
    });

    expect(
      reduce(armedSession(), { kind: "open", target: itemId }, meta()),
    ).toEqual({
      next: {},
      effect: { kind: "open", target: itemId },
    });
  });

  test("does not mutate its input session", () => {
    const session: VoiceSession = {
      pendingConfirm: {
        itemId,
        actionId: "merge",
        label: "Merge",
        armedAt: new Date(now).toISOString(),
      },
      dictating: {
        itemId,
        actionId: "comment",
      },
    };
    const snapshot = structuredClone(session);

    const result = reduce(
      session,
      { kind: "dictation_body", text: "looks good" },
      meta(),
    );

    expect(session).toEqual(snapshot);
    expect(result.next).not.toBe(session);
    expect(result.next.dictating).not.toBe(session.dictating);
  });
});
