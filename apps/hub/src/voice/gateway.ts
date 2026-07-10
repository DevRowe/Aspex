import {
  type Action,
  type ActionResult,
  type ClientDirective,
  type Intent,
  type IntentAck,
  type IntentCandidate,
  type IntentSource,
  type ItemId,
  type NoMatchReason,
  type StatusReport,
  type Transcript,
  type VoiceContext,
  type VoiceResult,
  type VoiceSession,
  isIntentResult,
} from "@aspex/schema";
import { parse } from "./grammar";
import type { IntentService } from "./intentService";
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
  dispatchIntent?: (intent: {
    verb: "dispatch";
    intentId: string;
    orchestrator: string;
    instruction: string;
    confirmed: true;
  }) => Promise<IntentAck>;
  queryIntent?: (intent: {
    verb: "status_query";
    intentId: string;
    scope: "needs_me";
  }) => Promise<StatusReport>;
  getSelectedActions: (id: ItemId) => Action[];
  resolveProject: (name: string) => ItemId | "ambiguous" | null;
  snapshotNeedsMe: () => ItemId[];
  readItem: (id: ItemId) => string;
  confidenceThreshold: number;
  confirmTtlMs: number;
  now?: () => number;
  intentService?: IntentService;
  snapshotCandidates?: () => IntentCandidate[];
  elevateFreeformConfirm?: boolean;
  maxClientSessions?: number;
}

interface EffectResult {
  ok: boolean;
  readback: string;
  directive?: ClientDirective;
}

interface ClientSession {
  session: VoiceSession;
  usedAt: number;
  generation: number;
}

export class VoiceGateway {
  private sessions = new Map<string, ClientSession>();
  private readonly maxClientSessions: number;

  constructor(private deps: GatewayDeps) {
    this.maxClientSessions = Math.max(
      1,
      Math.floor(deps.maxClientSessions ?? 256),
    );
  }

  async handle(
    audio: Uint8Array,
    mime: string,
    context: VoiceContext,
    intentId?: string,
    clientSessionId = "direct",
    generation = 0,
  ): Promise<VoiceGatewayResult> {
    const session = this.sessionForRequest(clientSessionId, generation);
    if (session === undefined) {
      return this.cancelledResult();
    }
    let transcript: Transcript;
    try {
      transcript = await this.deps.stt.transcribe(audio, mime);
    } catch {
      if (!this.isRequestCurrent(clientSessionId, generation)) {
        return this.cancelledResult();
      }
      return this.withAudio({
        ok: false,
        readback: "I couldn't hear that.",
        session,
      });
    }

    return this.runPipeline(
      transcript,
      context,
      intentId,
      clientSessionId,
      generation,
    );
  }

  async handleText(
    text: string,
    context: VoiceContext,
    intentId?: string,
    clientSessionId = "direct",
    generation = 0,
  ): Promise<VoiceGatewayResult> {
    return this.runPipeline(
      { text, confidence: 1 },
      context,
      intentId,
      clientSessionId,
      generation,
    );
  }

  async cancel(
    clientSessionId = "direct",
    generation = 0,
  ): Promise<VoiceGatewayResult> {
    this.pruneSessions();
    const current = this.sessions.get(clientSessionId);
    if (current === undefined || generation >= current.generation) {
      this.storeSession(clientSessionId, {
        session: {},
        generation,
        usedAt: this.now(),
      });
    }
    return this.cancelledResult();
  }

  private async runPipeline(
    transcript: Transcript,
    context: VoiceContext,
    intentId?: string,
    clientSessionId = "direct",
    generation = 0,
  ): Promise<VoiceGatewayResult> {
    const session = this.sessionForRequest(clientSessionId, generation);
    if (session === undefined) {
      return this.cancelledResult();
    }
    let provenance: IntentSource = "grammar";
    const selectedActions =
      context.selectedId === undefined
        ? []
        : this.deps.getSelectedActions(context.selectedId);

    let intent = parse({
      transcript,
      context,
      session,
      selectedActions,
      resolveProject: this.deps.resolveProject,
      confidenceThreshold: this.deps.confidenceThreshold,
      ...(intentId !== undefined ? { intentId } : {}),
    });

    if (
      intent.kind === "no_match" &&
      intent.reason === "unknown_command" &&
      this.deps.intentService !== undefined &&
      this.deps.snapshotCandidates !== undefined
    ) {
      const result = await this.deps.intentService.resolve({
        text: transcript.text,
        context,
        candidates: this.deps.snapshotCandidates(),
      });
      intent = isIntentResult(result)
        ? result.intent
        : freeformNoMatch(transcript.text);
      provenance = "freeform";
    }

    const { next, effect } = reduce(session, intent, {
      now: this.now(),
      confirmTtlMs: this.deps.confirmTtlMs,
      requiresConfirmation: (itemId, actionId) =>
        this.actionFor(itemId, actionId)?.requiresConfirmation === true ||
        (provenance === "freeform" &&
          (this.deps.elevateFreeformConfirm ?? true)),
      actionLabel: (itemId, actionId) =>
        this.actionFor(itemId, actionId)?.label ?? actionId,
    });

    if (!this.commitSession(clientSessionId, generation, next)) {
      return this.cancelledResult();
    }

    const effectResult = await this.performEffect(effect, intent, provenance);
    return this.withAudio({ ...effectResult, session: cloneSession(next) });
  }

  private sessionForRequest(
    clientSessionId: string,
    generation: number,
  ): VoiceSession | undefined {
    this.pruneSessions();
    const current = this.sessions.get(clientSessionId);
    if (current === undefined) {
      this.storeSession(clientSessionId, {
        session: {},
        generation,
        usedAt: this.now(),
      });
      return {};
    }
    if (generation < current.generation) {
      return undefined;
    }
    current.generation = generation;
    current.usedAt = this.now();
    this.storeSession(clientSessionId, current);
    return cloneSession(current.session);
  }

  private commitSession(
    clientSessionId: string,
    generation: number,
    session: VoiceSession,
  ): boolean {
    const current = this.sessions.get(clientSessionId);
    if (current === undefined || current.generation !== generation) {
      return false;
    }
    current.session = session;
    current.usedAt = this.now();
    this.storeSession(clientSessionId, current);
    return true;
  }

  private isRequestCurrent(
    clientSessionId: string,
    generation: number,
  ): boolean {
    return this.sessions.get(clientSessionId)?.generation === generation;
  }

  private cancelledResult(): Promise<VoiceGatewayResult> {
    return this.withAudio({ ok: true, readback: "Cancelled.", session: {} });
  }

  private pruneSessions(): void {
    const expiry = this.now() - Math.max(this.deps.confirmTtlMs, 300_000);
    for (const [clientSessionId, entry] of this.sessions) {
      if (entry.usedAt < expiry) {
        this.sessions.delete(clientSessionId);
      }
    }
    while (this.sessions.size > this.maxClientSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.sessions.delete(oldest);
    }
  }

  private storeSession(clientSessionId: string, session: ClientSession): void {
    this.sessions.delete(clientSessionId);
    this.sessions.set(clientSessionId, session);
    this.pruneSessions();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async performEffect(
    effect: Effect,
    intent: Intent,
    provenance: IntentSource,
  ): Promise<EffectResult> {
    let result: EffectResult;

    switch (effect.kind) {
      case "dispatch":
        result = await this.dispatchEffect(effect, intent);
        break;

      case "dispatchIntent":
        result = await this.dispatchIntentEffect(effect);
        break;

      case "queryIntent":
        result = await this.queryIntentEffect(effect);
        break;

      case "navigate":
        result = {
          ok: true,
          readback: this.navigationReadback(effect.directive),
          directive: effect.directive,
        };
        break;

      case "read":
        result = { ok: true, readback: this.deps.readItem(effect.target) };
        break;

      case "open":
        result = {
          ok: true,
          readback: `Opening ${effect.target}.`,
          directive: { type: "open", id: effect.target },
        };
        break;

      case "armed":
        result = {
          ok: true,
          readback:
            effect.actionId === "ship"
              ? `Say 'merge' or 'ship' to ${effect.label} ${effect.itemId}.`
              : `Say 'confirm ${effect.actionId}' to ${effect.label} ${effect.itemId}.`,
        };
        break;

      case "armedDispatch":
        result = {
          ok: true,
          readback: `Dispatch armed: ${effect.instruction}. Say 'confirm dispatch' to send it, or 'cancel'.`,
        };
        break;

      case "dictation_prompt":
        result = {
          ok: true,
          readback: `Dictate your ${dictationLabel(effect.actionId)}, then say 'post it'.`,
        };
        break;

      case "dictation_readback":
        result = {
          ok: true,
          readback: `I heard: ${effect.body}. Say 'post it' to send, or 'cancel'.`,
        };
        break;

      case "noMatch":
        result = { ok: false, readback: noMatchReadback(effect.reason) };
        break;

      case "cancelled":
        result = { ok: true, readback: "Cancelled." };
        break;

      case "none":
        result = { ok: true, readback: "Done." };
        break;
    }

    return provenance === "freeform"
      ? withFreeformReadback(effect, result)
      : result;
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

  private async dispatchIntentEffect(
    effect: Extract<Effect, { kind: "dispatchIntent" }>,
  ): Promise<EffectResult> {
    if (this.deps.dispatchIntent === undefined) {
      return { ok: false, readback: "Dispatch is not configured." };
    }
    const result = await this.deps.dispatchIntent({
      verb: "dispatch",
      intentId: effect.intentId,
      orchestrator: effect.orchestrator,
      instruction: effect.instruction,
      confirmed: true,
    });
    return {
      ok: result.ok,
      readback:
        result.message ??
        (result.ok
          ? "Dispatched. The resulting item will appear in the stream."
          : "Dispatch failed."),
    };
  }

  private async queryIntentEffect(
    effect: Extract<Effect, { kind: "queryIntent" }>,
  ): Promise<EffectResult> {
    if (this.deps.queryIntent === undefined) {
      return { ok: false, readback: "Status query is not configured." };
    }
    const result = await this.deps.queryIntent({
      verb: "status_query",
      intentId: effect.intentId,
      scope: "needs_me",
    });
    return {
      ok: result.ok,
      readback: result.text,
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

function freeformNoMatch(text: string): Intent {
  return { kind: "no_match", heard: text, reason: "unknown_command" };
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

function withFreeformReadback(
  effect: Effect,
  result: EffectResult,
): EffectResult {
  const interpretation = effectInterpretation(effect);
  if (interpretation === undefined) {
    return result;
  }

  return {
    ...result,
    readback: `I read that as: ${interpretation}. ${result.readback}`,
  };
}

function effectInterpretation(effect: Effect): string | undefined {
  switch (effect.kind) {
    case "dispatch":
    case "armed":
      return `${effect.actionId} ${effect.itemId}`;
    case "dispatchIntent":
    case "armedDispatch":
      return `dispatch ${effect.instruction}`;
    case "queryIntent":
      return "query status";
    case "read":
      return `read ${effect.target}`;
    case "open":
      return `open ${effect.target}`;
    case "navigate":
      return directiveInterpretation(effect.directive);
    default:
      return undefined;
  }
}

function directiveInterpretation(directive: ClientDirective): string {
  switch (directive.type) {
    case "show_needs_me":
      return "show what needs you";
    case "select":
      return `focus ${directive.id}`;
    case "move":
      return directive.delta === 1 ? "move to next" : "move to previous";
    case "open":
      return `open ${directive.id}`;
    case "none":
      return "do nothing";
  }
}

function cloneSession(session: VoiceSession): VoiceSession {
  return {
    ...(session.pendingConfirm !== undefined
      ? { pendingConfirm: { ...session.pendingConfirm } }
      : {}),
    ...(session.pendingDispatch !== undefined
      ? { pendingDispatch: { ...session.pendingDispatch } }
      : {}),
    ...(session.dictating !== undefined
      ? { dictating: { ...session.dictating } }
      : {}),
  };
}
