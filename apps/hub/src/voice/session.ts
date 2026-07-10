import { randomUUID } from "node:crypto";
import { isMergeWord } from "@aspex/schema";
import type {
  ClientDirective,
  Intent,
  ItemId,
  MergeWord,
  NoMatchReason,
  VoiceSession,
} from "@aspex/schema";

export type Effect =
  | { kind: "dispatch"; itemId: ItemId; actionId: string; payload?: unknown }
  | {
      kind: "dispatchIntent";
      intentId: string;
      orchestrator: string;
      instruction: string;
    }
  | { kind: "queryIntent"; intentId: string }
  | { kind: "navigate"; directive: ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "armed"; itemId: ItemId; actionId: string; label: string }
  | { kind: "armedDispatch"; instruction: string }
  | { kind: "dictation_prompt"; itemId: ItemId; actionId: string }
  | {
      kind: "dictation_readback";
      itemId: ItemId;
      actionId: string;
      body: string;
    }
  | { kind: "noMatch"; reason: NoMatchReason; heard?: string }
  | { kind: "cancelled" }
  | { kind: "none" };

export interface ReduceMeta {
  now: number;
  confirmTtlMs: number;
  randomUuid?: () => string;
  requiresConfirmation: (itemId: ItemId, actionId: string) => boolean;
  actionLabel: (itemId: ItemId, actionId: string) => string;
}

export function reduce(
  session: VoiceSession,
  intent: Intent,
  meta: ReduceMeta,
): { next: VoiceSession; effect: Effect } {
  const current = clearExpiredPendingConfirm(session, meta);

  switch (intent.kind) {
    case "action": {
      if (meta.requiresConfirmation(intent.itemId, intent.actionId)) {
        const label = meta.actionLabel(intent.itemId, intent.actionId);
        const pendingConfirm = {
          itemId: intent.itemId,
          actionId: intent.actionId,
          label,
          armedAt: new Date(meta.now).toISOString(),
          ...(intent.intentId !== undefined
            ? { intentId: intent.intentId }
            : {}),
        };

        return {
          next: {
            ...withoutPendingDispatch(withoutPendingConfirm(current)),
            pendingConfirm,
          },
          effect: {
            kind: "armed",
            itemId: intent.itemId,
            actionId: intent.actionId,
            label,
          },
        };
      }

      return {
        next: withoutPendingDispatch(withoutPendingConfirm(current)),
        effect: {
          kind: "dispatch",
          itemId: intent.itemId,
          actionId: intent.actionId,
          ...(intent.intentId !== undefined
            ? { payload: { intentId: intent.intentId } }
            : {}),
        },
      };
    }

    case "confirm": {
      const pending = current.pendingConfirm;
      if (
        pending !== undefined &&
        pending.itemId === intent.itemId &&
        pending.actionId === intent.actionId &&
        (pending.actionId !== "ship" || isMergeWord(intent.mergeWord))
      ) {
        const payload = confirmationPayload(pending, intent.mergeWord);
        return {
          next: withoutPendingConfirm(current),
          effect: {
            kind: "dispatch",
            itemId: intent.itemId,
            actionId: intent.actionId,
            ...(payload !== undefined ? { payload } : {}),
          },
        };
      }

      return {
        next: pending === undefined ? current : withoutPendingConfirm(current),
        effect: { kind: "noMatch", reason: "unknown_command" },
      };
    }

    case "dictate":
      return {
        next: {
          ...withoutPendingDispatch(withoutPendingConfirm(current)),
          dictating: {
            itemId: intent.itemId,
            actionId: intent.actionId,
            ...(intent.intentId !== undefined
              ? { intentId: intent.intentId }
              : {}),
          },
        },
        effect: {
          kind: "dictation_prompt",
          itemId: intent.itemId,
          actionId: intent.actionId,
        },
      };

    case "dictation_body": {
      const dictating = current.dictating;
      if (dictating === undefined) {
        return {
          next: current,
          effect: { kind: "noMatch", reason: "unknown_command" },
        };
      }

      return {
        next: {
          ...current,
          dictating: { ...dictating, pendingBody: intent.text },
        },
        effect: {
          kind: "dictation_readback",
          itemId: dictating.itemId,
          actionId: dictating.actionId,
          body: intent.text,
        },
      };
    }

    case "post": {
      const dictating = current.dictating;
      if (dictating?.pendingBody === undefined) {
        return {
          next: withoutPendingConfirm(current),
          effect: { kind: "noMatch", reason: "unknown_command" },
        };
      }

      const payload = dictationPayload(
        dictating.actionId,
        dictating.pendingBody,
        dictating.intentId,
      );
      if (meta.requiresConfirmation(dictating.itemId, dictating.actionId)) {
        const label = meta.actionLabel(dictating.itemId, dictating.actionId);
        return {
          next: {
            pendingConfirm: {
              itemId: dictating.itemId,
              actionId: dictating.actionId,
              label,
              armedAt: new Date(meta.now).toISOString(),
              payload,
              ...(dictating.intentId !== undefined
                ? { intentId: dictating.intentId }
                : {}),
            },
          },
          effect: {
            kind: "armed",
            itemId: dictating.itemId,
            actionId: dictating.actionId,
            label,
          },
        };
      }
      return {
        next: withoutPendingDispatch(
          withoutPendingConfirm(withoutDictating(current)),
        ),
        effect: {
          kind: "dispatch",
          itemId: dictating.itemId,
          actionId: dictating.actionId,
          payload,
        },
      };
    }

    case "dispatch_task": {
      const intentId =
        intent.intentId ?? fallbackIntentId(meta.now, meta.randomUuid);
      return {
        next: {
          pendingDispatch: {
            intentId,
            orchestrator: intent.orchestrator,
            instruction: intent.instruction,
            armedAt: new Date(meta.now).toISOString(),
          },
        },
        effect: { kind: "armedDispatch", instruction: intent.instruction },
      };
    }

    case "confirm_dispatch": {
      const pending = current.pendingDispatch;
      if (
        pending !== undefined &&
        (intent.intentId === undefined || intent.intentId === pending.intentId)
      ) {
        return {
          next: withoutPendingDispatch(current),
          effect: {
            kind: "dispatchIntent",
            intentId: pending.intentId,
            orchestrator: pending.orchestrator,
            instruction: pending.instruction,
          },
        };
      }
      return {
        next: withoutPendingDispatch(current),
        effect: { kind: "noMatch", reason: "unknown_command" },
      };
    }

    case "status_query":
      return {
        next: withoutPendingDispatch(withoutPendingConfirm(current)),
        effect: {
          kind: "queryIntent",
          intentId:
            intent.intentId ?? fallbackIntentId(meta.now, meta.randomUuid),
        },
      };

    case "cancel":
      return { next: {}, effect: { kind: "cancelled" } };

    case "nav":
      return {
        next: withoutPendingDispatch(withoutPendingConfirm(current)),
        effect: { kind: "navigate", directive: intent.directive },
      };

    case "read":
      return {
        next: withoutPendingDispatch(withoutPendingConfirm(current)),
        effect: { kind: "read", target: intent.target },
      };

    case "open":
      return {
        next: withoutPendingDispatch(withoutPendingConfirm(current)),
        effect: { kind: "open", target: intent.target },
      };

    case "no_match":
      return {
        next: current,
        effect: {
          kind: "noMatch",
          reason: intent.reason,
          heard: intent.heard,
        },
      };
  }
}

function clearExpiredPendingConfirm(
  session: VoiceSession,
  meta: ReduceMeta,
): VoiceSession {
  let current = cloneSession(session);
  const pending = current.pendingConfirm;
  if (
    pending !== undefined &&
    meta.now - Date.parse(pending.armedAt) > meta.confirmTtlMs
  ) {
    current = withoutPendingConfirm(current);
  }
  const pendingDispatch = current.pendingDispatch;
  if (
    pendingDispatch !== undefined &&
    meta.now - Date.parse(pendingDispatch.armedAt) > meta.confirmTtlMs
  ) {
    current = withoutPendingDispatch(current);
  }
  return current;
}

function cloneSession(session: VoiceSession): VoiceSession {
  const next: VoiceSession = {};
  if (session.pendingConfirm !== undefined) {
    next.pendingConfirm = { ...session.pendingConfirm };
  }
  if (session.dictating !== undefined) {
    next.dictating = { ...session.dictating };
  }
  if (session.pendingDispatch !== undefined) {
    next.pendingDispatch = { ...session.pendingDispatch };
  }
  return next;
}

function withoutPendingConfirm(session: VoiceSession): VoiceSession {
  const { pendingConfirm: _pendingConfirm, ...rest } = session;
  const next: VoiceSession = { ...rest };
  if (session.dictating !== undefined) {
    next.dictating = { ...session.dictating };
  }
  if (session.pendingDispatch !== undefined) {
    next.pendingDispatch = { ...session.pendingDispatch };
  }
  return next;
}

function withoutDictating(session: VoiceSession): VoiceSession {
  const { dictating: _dictating, ...rest } = session;
  const next: VoiceSession = { ...rest };
  if (session.pendingConfirm !== undefined) {
    next.pendingConfirm = { ...session.pendingConfirm };
  }
  if (session.pendingDispatch !== undefined) {
    next.pendingDispatch = { ...session.pendingDispatch };
  }
  return next;
}

function withoutPendingDispatch(session: VoiceSession): VoiceSession {
  const { pendingDispatch: _pendingDispatch, ...rest } = session;
  return cloneSession(rest);
}

function dictationPayload(
  actionId: string,
  body: string,
  intentId: string | undefined,
): Record<string, unknown> {
  const textVerbs = new Set(["answer", "redirect", "deny"]);
  return {
    [textVerbs.has(actionId) ? "text" : "body"]: body,
    ...(intentId !== undefined ? { intentId } : {}),
  };
}

function confirmationPayload(
  pending: NonNullable<VoiceSession["pendingConfirm"]>,
  mergeWord: MergeWord | undefined,
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> =
    pending.payload !== undefined && isRecord(pending.payload)
      ? { ...pending.payload }
      : pending.intentId !== undefined
        ? { intentId: pending.intentId }
        : {};

  if (mergeWord !== undefined) {
    payload.mergeWord = mergeWord;
  }

  return Object.keys(payload).length === 0 ? undefined : payload;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fallbackIntentId(
  now: number,
  randomUuid: () => string = randomUUID,
): string {
  return `voice-${now.toString(36)}-${randomUuid()}`;
}
