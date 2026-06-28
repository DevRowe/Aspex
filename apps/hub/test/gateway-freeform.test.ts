import { describe, expect, mock, test } from "bun:test";
import type {
  Action,
  ActionResult,
  Intent,
  IntentCandidate,
  IntentRequest,
  IntentResult,
  ItemId,
} from "@aspex/schema";
import { type GatewayDeps, VoiceGateway } from "../src/voice/gateway";
import {
  type IntentService,
  MockIntentService,
} from "../src/voice/intentService";
import { MockSttClient } from "../src/voice/sttClient";

const itemId: ItemId = "github:pr:brocorp/aspex#50";
const audio = new Uint8Array([5, 0]);
const context = { selectedId: itemId, needsMeIds: [itemId] };

function makeGateway(
  transcripts: ConstructorParameters<typeof MockSttClient>[0],
  overrides: Partial<GatewayDeps> = {},
) {
  const dispatchAction = mock(
    async (): Promise<ActionResult> => ({ ok: true, message: "Action done." }),
  );
  const resolve = mock(
    async (req: IntentRequest): Promise<IntentResult> => ({
      intent: {
        kind: "no_match",
        heard: req.text,
        reason: "unknown_command",
      },
      source: "freeform",
    }),
  );
  const intentService: IntentService = { resolve };
  const snapshotCandidates = mock((): IntentCandidate[] => [
    {
      itemId,
      summary: "Atlas review is ready.",
      actions: ["approve", "merge", "comment"],
    },
  ]);
  const deps: GatewayDeps = {
    stt: new MockSttClient(transcripts),
    tts: null,
    dispatchAction,
    getSelectedActions: () => [
      action("approve"),
      action("merge", { requiresConfirmation: true }),
      action("comment"),
    ],
    resolveProject: () => null,
    snapshotNeedsMe: () => [itemId],
    readItem: (id) => `Read ${id}.`,
    confidenceThreshold: 0.8,
    confirmTtlMs: 30_000,
    now: () => Date.parse("2026-06-28T04:00:00.000Z"),
    intentService,
    snapshotCandidates,
    ...overrides,
  };

  return {
    gateway: new VoiceGateway(deps),
    dispatchAction,
    resolve,
    snapshotCandidates,
  };
}

function withMockIntentService(script: Intent[]): {
  service: IntentService;
  resolve: ReturnType<typeof mock>;
} {
  const mockService = new MockIntentService(script);
  const resolve = mock((req: IntentRequest) => mockService.resolve(req));
  return { service: { resolve }, resolve };
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

describe("VoiceGateway free-form fallback", () => {
  test("closed grammar match does not call intent service", async () => {
    const { gateway, dispatchAction, resolve } = makeGateway(["approve"]);

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(true);
    expect(result.readback).toBe("Action done.");
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("unknown utterance arms free-form action and follow-up confirm dispatches once", async () => {
    const { service, resolve } = withMockIntentService([
      { kind: "action", itemId, actionId: "approve" },
    ]);
    const { gateway, dispatchAction } = makeGateway(
      ["please approve the atlas review", "confirm approve"],
      { intentService: service },
    );

    const armed = await gateway.handle(audio, "audio/webm", context);
    const confirmed = await gateway.handle(audio, "audio/webm", context);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[0]).toEqual({
      text: "please approve the atlas review",
      context,
      candidates: [
        {
          itemId,
          summary: "Atlas review is ready.",
          actions: ["approve", "merge", "comment"],
        },
      ],
    });
    expect(armed.ok).toBe(true);
    expect(armed.readback).toContain("I read that as: approve");
    expect(armed.readback).toContain("confirm approve");
    expect(armed.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "approve",
    });
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith(itemId, "approve", {
      confirmed: true,
    });
    expect(confirmed.readback).toBe("Action done.");
  });

  test("low_confidence does not call intent service", async () => {
    const { gateway, resolve } = makeGateway([
      { text: "please approve the atlas review", confidence: 0.2 },
    ]);

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(false);
    expect(result.readback).toContain("clearly");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("no_referent does not call intent service", async () => {
    const { gateway, resolve } = makeGateway(["approve"]);

    const result = await gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId],
    });

    expect(result.ok).toBe(false);
    expect(result.readback).toBe("I need an item selected first.");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("action_unavailable does not call intent service", async () => {
    const { gateway, resolve } = makeGateway(["re-run checks"]);

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(false);
    expect(result.readback).toBe("That action is not available for this item.");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("ambiguous does not call intent service", async () => {
    const { gateway, resolve } = makeGateway(["focus atlas"], {
      resolveProject: () => "ambiguous",
    });

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(false);
    expect(result.readback).toBe("That matched more than one item.");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("no intentService leaves unknown_command as normal no_match", async () => {
    const { gateway, resolve, snapshotCandidates } = makeGateway(
      ["please approve the atlas review"],
      { intentService: undefined },
    );

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(false);
    expect(result.readback).toBe("I didn't understand that command.");
    expect(resolve).not.toHaveBeenCalled();
    expect(snapshotCandidates).not.toHaveBeenCalled();
  });

  test("no snapshotCandidates leaves unknown_command as normal no_match", async () => {
    const { gateway, resolve } = makeGateway(
      ["please approve the atlas review"],
      { snapshotCandidates: undefined },
    );

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(false);
    expect(result.readback).toBe("I didn't understand that command.");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("elevateFreeformConfirm true makes safe action arm", async () => {
    const { service, resolve } = withMockIntentService([
      { kind: "action", itemId, actionId: "approve" },
    ]);
    const { gateway, dispatchAction } = makeGateway(
      ["please approve the atlas review"],
      { intentService: service, elevateFreeformConfirm: true },
    );

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "approve",
    });
    expect(result.readback).toContain("I read that as: approve");
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("elevateFreeformConfirm false allows safe free-form dispatch with honest readback", async () => {
    const { service, resolve } = withMockIntentService([
      { kind: "action", itemId, actionId: "approve" },
    ]);
    const { gateway, dispatchAction } = makeGateway(
      ["please approve the atlas review"],
      { intentService: service, elevateFreeformConfirm: false },
    );

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(result.readback).toBe(
      `I read that as: approve ${itemId}. Action done.`,
    );
  });

  test("free-form navigate readback names the interpretation", async () => {
    const { service } = withMockIntentService([
      { kind: "nav", directive: { type: "show_needs_me" } },
    ]);
    const { gateway } = makeGateway(["show me the queue"], {
      intentService: service,
    });

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(true);
    expect(result.directive).toEqual({ type: "show_needs_me" });
    expect(result.readback).toBe(
      `I read that as: show what needs you. Needs you: ${itemId}.`,
    );
  });

  test("free-form read readback names the interpretation", async () => {
    const { service } = withMockIntentService([
      { kind: "read", target: itemId },
    ]);
    const { gateway } = makeGateway(["summarize the atlas review"], {
      intentService: service,
    });

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(true);
    expect(result.readback).toBe(
      `I read that as: read ${itemId}. Read ${itemId}.`,
    );
  });

  test("free-form open readback names the interpretation", async () => {
    const { service } = withMockIntentService([
      { kind: "open", target: itemId },
    ]);
    const { gateway } = makeGateway(["open the atlas review"], {
      intentService: service,
    });

    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result.ok).toBe(true);
    expect(result.directive).toEqual({ type: "open", id: itemId });
    expect(result.readback).toBe(
      `I read that as: open ${itemId}. Opening ${itemId}.`,
    );
  });

  test("free-form confirm result is rejected before it can dispatch", async () => {
    const { service, resolve } = withMockIntentService([
      { kind: "confirm", itemId, actionId: "merge" },
    ]);
    const { gateway, dispatchAction } = makeGateway(
      ["merge", "please complete that"],
      { intentService: service },
    );

    const armed = await gateway.handle(audio, "audio/webm", context);
    const rejected = await gateway.handle(audio, "audio/webm", context);

    expect(armed.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "merge",
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(rejected.ok).toBe(false);
    expect(rejected.readback).toBe("I didn't understand that command.");
    expect(rejected.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "merge",
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });
});
