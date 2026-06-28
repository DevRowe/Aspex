import type {
  Action,
  ActionResult,
  ClientDirective,
  Intent,
  ItemId,
  NoMatchReason,
  VoiceContext,
  VoiceResult,
  VoiceSession,
} from "@aspex/schema";
import { parse } from "./grammar";
import { type Effect, reduce } from "./session";
import type { SttClient } from "./sttClient";
import type { TtsClient } from "./ttsClient";

export interface VoiceGatewayResult extends VoiceResult {
  audio?: Uint8Array;
}

export interface GatewayDeps {
  stt: SttClient;
  tts: TtsClient | null;
  dispatchAction: (
    itemId: ItemId,
    actionId: string,
    payload?: unknown,
  ) => Promise<ActionResult>;
  getSelectedActions: (id: ItemId) => Action[];
  resolveProject: (name: string) => ItemId | "ambiguous" | null;
  snapshotNeedsMe: () => ItemId[];
  readItem: (id: ItemId) => string;
  confidenceThreshold: number;
  confirmTtlMs: number;
  now?: () => number;
}

interface EffectResult {
  ok: boolean;
  readback: string;
  directive?: ClientDirective;
}

export class VoiceGateway {
  private session: VoiceSession = {};

  constructor(private deps: GatewayDeps) {}

  async handle(
    audio: Uint8Array,
    mime: string,
    context: VoiceContext,
  ): Promise<VoiceGatewayResult> {
    let intent: Intent;

    try {
      const transcript = await this.deps.stt.transcribe(audio, mime);
      const selectedActions =
        context.selectedId === undefined
          ? []
          : this.deps.getSelectedActions(context.selectedId);

      intent = parse({
        transcript,
        context,
        session: this.session,
        selectedActions,
        resolveProject: this.deps.resolveProject,
        confidenceThreshold: this.deps.confidenceThreshold,
      });
    } catch {
      return this.withAudio({
        ok: false,
        readback: "I couldn't hear that.",
        session: this.session,
      });
    }

    const { next, effect } = reduce(this.session, intent, {
      now: this.deps.now?.() ?? Date.now(),
      confirmTtlMs: this.deps.confirmTtlMs,
      requiresConfirmation: (itemId, actionId) =>
        this.actionFor(itemId, actionId)?.requiresConfirmation === true,
      actionLabel: (itemId, actionId) =>
        this.actionFor(itemId, actionId)?.label ?? actionId,
    });

    this.session = next;

    const effectResult = await this.performEffect(effect, intent);
    return this.withAudio({ ...effectResult, session: this.session });
  }

  private async performEffect(
    effect: Effect,
    intent: Intent,
  ): Promise<EffectResult> {
    switch (effect.kind) {
      case "dispatch":
        return this.dispatchEffect(effect, intent);

      case "navigate":
        return {
          ok: true,
          readback: this.navigationReadback(effect.directive),
          directive: effect.directive,
        };

      case "read":
        return { ok: true, readback: this.deps.readItem(effect.target) };

      case "open":
        return {
          ok: true,
          readback: `Opening ${effect.target}.`,
          directive: { type: "open", id: effect.target },
        };

      case "armed":
        return {
          ok: true,
          readback: `Say 'confirm ${effect.actionId}' to ${effect.label} ${effect.itemId}.`,
        };

      case "dictation_prompt":
        return {
          ok: true,
          readback: `Dictate your ${dictationLabel(effect.actionId)}, then say 'post it'.`,
        };

      case "dictation_readback":
        return {
          ok: true,
          readback: `I heard: ${effect.body}. Say 'post it' to send, or 'cancel'.`,
        };

      case "noMatch":
        return { ok: false, readback: noMatchReadback(effect.reason) };

      case "cancelled":
        return { ok: true, readback: "Cancelled." };

      case "none":
        return { ok: true, readback: "Done." };
    }
  }

  private async dispatchEffect(
    effect: Extract<Effect, { kind: "dispatch" }>,
    intent: Intent,
  ): Promise<EffectResult> {
    const payload =
      intent.kind === "confirm"
        ? withConfirmed(effect.payload)
        : effect.payload;
    const result = await this.deps.dispatchAction(
      effect.itemId,
      effect.actionId,
      payload,
    );

    return {
      ok: result.ok,
      readback: result.message ?? (result.ok ? "Done." : "Action failed."),
    };
  }

  private async withAudio(result: VoiceResult): Promise<VoiceGatewayResult> {
    const bytes = await this.speak(result.readback);
    return bytes === undefined ? result : { ...result, audio: bytes };
  }

  private async speak(readback: string): Promise<Uint8Array | undefined> {
    if (this.deps.tts === null) {
      return undefined;
    }

    try {
      return (await this.deps.tts.speak(readback)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private actionFor(itemId: ItemId, actionId: string): Action | undefined {
    return this.deps
      .getSelectedActions(itemId)
      .find((action) => action.id === actionId);
  }

  private navigationReadback(directive: ClientDirective): string {
    switch (directive.type) {
      case "show_needs_me": {
        const ids = this.deps.snapshotNeedsMe();
        return ids.length === 0
          ? "Nothing needs you right now."
          : `Needs you: ${ids.join(", ")}.`;
      }
      case "select":
        return `Focused ${directive.id}.`;
      case "move":
        return directive.delta === 1 ? "Moved to next." : "Moved to previous.";
      case "open":
        return `Opening ${directive.id}.`;
      case "none":
        return "Done.";
    }
  }
}

function withConfirmed(payload: unknown): unknown {
  if (isRecord(payload) && !Array.isArray(payload)) {
    return { ...payload, confirmed: true };
  }

  return { confirmed: true };
}

function dictationLabel(actionId: string): string {
  return actionId === "request_changes" ? "changes" : actionId;
}

function noMatchReadback(reason: NoMatchReason): string {
  switch (reason) {
    case "low_confidence":
      return "I couldn't hear that clearly.";
    case "no_referent":
      return "I need an item selected first.";
    case "action_unavailable":
      return "That action is not available for this item.";
    case "ambiguous":
      return "That matched more than one item.";
    case "unknown_command":
      return "I didn't understand that command.";
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;
