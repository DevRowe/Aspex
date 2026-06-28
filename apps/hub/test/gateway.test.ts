import { describe, expect, mock, test } from "bun:test";
import type { Action, ActionResult, ItemId } from "@aspex/schema";
import { type GatewayDeps, VoiceGateway } from "../src/voice/gateway";
import { MockSttClient, type SttClient } from "../src/voice/sttClient";
import { MockTtsClient, type TtsClient } from "../src/voice/ttsClient";

const itemId: ItemId = "github:pr:brocorp/aspex#27";
const secondId: ItemId = "github:pr:brocorp/aspex#28";
const audio = new Uint8Array([1, 2, 3]);

function makeGateway(
  transcripts: ConstructorParameters<typeof MockSttClient>[0],
  overrides: Partial<GatewayDeps> = {},
) {
  const dispatchAction = mock(
    async (): Promise<ActionResult> => ({ ok: true, message: "Action done." }),
  );
  const deps: GatewayDeps = {
    stt: new MockSttClient(transcripts),
    tts: null,
    dispatchAction,
    getSelectedActions: () => [
      action("approve"),
      action("merge", { label: "Merge", requiresConfirmation: true }),
      action("comment"),
      action("request_changes"),
    ],
    resolveProject: () => null,
    snapshotNeedsMe: () => [itemId, secondId],
    readItem: (id) => `Read ${id}.`,
    confidenceThreshold: 0.8,
    confirmTtlMs: 30_000,
    now: () => Date.parse("2026-06-28T04:00:00.000Z"),
    ...overrides,
  };

  return { gateway: new VoiceGateway(deps), dispatchAction, deps };
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

describe("VoiceGateway", () => {
  test("merge on selected Item arms confirmation and does not dispatch", async () => {
    const { gateway, dispatchAction } = makeGateway(["merge"]);

    const result = await gateway.handle(audio, "audio/webm", {
      selectedId: itemId,
      needsMeIds: [itemId],
    });

    expect(result.ok).toBe(true);
    expect(result.readback).toContain("confirm merge");
    expect(result.session.pendingConfirm).toMatchObject({
      itemId,
      actionId: "merge",
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("confirm merge dispatches with confirmed payload and action readback", async () => {
    const { gateway, dispatchAction } = makeGateway(["merge", "confirm merge"]);
    dispatchAction.mockImplementation(async () => ({
      ok: true,
      message: "Merged.",
    }));
    const context = { selectedId: itemId, needsMeIds: [itemId] };

    await gateway.handle(audio, "audio/webm", context);
    const result = await gateway.handle(audio, "audio/webm", context);

    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith(itemId, "merge", {
      confirmed: true,
    });
    expect(result.readback).toBe("Merged.");
    expect(result.session.pendingConfirm).toBeUndefined();
  });

  test("cancel clears armed confirmation without dispatching", async () => {
    const { gateway, dispatchAction } = makeGateway(["merge", "cancel"]);
    const context = { selectedId: itemId, needsMeIds: [itemId] };

    await gateway.handle(audio, "audio/webm", context);
    const result = await gateway.handle(audio, "audio/webm", context);

    expect(result).toMatchObject({
      ok: true,
      readback: "Cancelled.",
      session: {},
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("comment prompts dictation, reads body back, then posts it", async () => {
    const { gateway, dispatchAction } = makeGateway([
      "comment",
      "looks good to me",
      "post it",
    ]);
    const context = { selectedId: itemId, needsMeIds: [itemId] };

    const prompt = await gateway.handle(audio, "audio/webm", context);
    const body = await gateway.handle(audio, "audio/webm", context);
    const posted = await gateway.handle(audio, "audio/webm", context);

    expect(prompt.readback).toContain("Dictate your comment");
    expect(prompt.session.dictating).toEqual({ itemId, actionId: "comment" });
    expect(body.readback).toContain("looks good to me");
    expect(body.readback).toContain("post it");
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith(itemId, "comment", {
      body: "looks good to me",
    });
    expect(posted.ok).toBe(true);
  });

  test("open it returns an open directive for the selected Item", async () => {
    const { gateway, dispatchAction } = makeGateway(["open it"]);

    const result = await gateway.handle(audio, "audio/webm", {
      selectedId: itemId,
      needsMeIds: [itemId],
    });

    expect(result.ok).toBe(true);
    expect(result.directive).toEqual({ type: "open", id: itemId });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("low confidence transcript rejects without dispatch", async () => {
    const { gateway, dispatchAction } = makeGateway([
      { text: "merge", confidence: 0.2 },
    ]);

    const result = await gateway.handle(audio, "audio/webm", {
      selectedId: itemId,
      needsMeIds: [itemId],
    });

    expect(result.ok).toBe(false);
    expect(result.readback).toContain("clearly");
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("STT failure returns friendly readback without dispatch", async () => {
    const dispatchAction = mock(
      async (): Promise<ActionResult> => ({ ok: true }),
    );
    const stt: SttClient = {
      async transcribe() {
        throw new Error("offline");
      },
    };
    const { gateway } = makeGateway([], { stt, dispatchAction });

    const result = await gateway.handle(audio, "audio/webm", {
      selectedId: itemId,
      needsMeIds: [itemId],
    });

    expect(result).toEqual({
      ok: false,
      readback: "I couldn't hear that.",
      session: {},
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("what needs me directs the client and lists mocked needs-me Items", async () => {
    const { gateway, dispatchAction } = makeGateway(["what needs me"]);

    const result = await gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId, secondId],
    });

    expect(result.ok).toBe(true);
    expect(result.directive).toEqual({ type: "show_needs_me" });
    expect(result.readback).toContain(itemId);
    expect(result.readback).toContain(secondId);
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  test("includes raw audio bytes when TTS is enabled", async () => {
    const { gateway } = makeGateway(["what needs me"], {
      tts: new MockTtsClient(),
    });

    const result = await gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId],
    });

    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.audioUrl).toBeUndefined();
  });

  test("omits audio when TTS is null, returns null, or fails", async () => {
    const nullTts = makeGateway(["what needs me"], { tts: null });
    const nullResult = await nullTts.gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId],
    });
    const emptyTts = makeGateway(["what needs me"], {
      tts: new MockTtsClient({ disabled: true }),
    });
    const emptyResult = await emptyTts.gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId],
    });
    const failingTts: TtsClient = {
      async speak() {
        throw new Error("tts offline");
      },
    };
    const failedTts = makeGateway(["what needs me"], { tts: failingTts });
    const failedResult = await failedTts.gateway.handle(audio, "audio/webm", {
      needsMeIds: [itemId],
    });

    expect(nullResult.audio).toBeUndefined();
    expect(emptyResult.audio).toBeUndefined();
    expect(failedResult.audio).toBeUndefined();
  });
});
