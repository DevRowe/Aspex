import type {
  ClientDirective,
  Intent,
  ItemId,
  NoMatchReason,
  VoiceSession,
} from "@aspex/schema";

export type Effect =
  | { kind: "dispatch"; itemId: ItemId; actionId: string; payload?: unknown }
  | { kind: "navigate"; directive: ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "armed"; itemId: ItemId; actionId: string; label: string }
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
        };

        return {
          next: { ...withoutPendingConfirm(current), pendingConfirm },
          effect: {
            kind: "armed",
            itemId: intent.itemId,
            actionId: intent.actionId,
            label,
          },
        };
      }

      return {
        next: withoutPendingConfirm(current),
        effect: {
          kind: "dispatch",
          itemId: intent.itemId,
          actionId: intent.actionId,
        },
      };
    }

    case "confirm": {
      const pending = current.pendingConfirm;
      if (
        pending !== undefined &&
        pending.itemId === intent.itemId &&
        pending.actionId === intent.actionId
      ) {
        return {
          next: withoutPendingConfirm(current),
          effect: {
            kind: "dispatch",
            itemId: intent.itemId,
            actionId: intent.actionId,
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
          ...withoutPendingConfirm(current),
          dictating: { itemId: intent.itemId, actionId: intent.actionId },
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

      return {
        next: withoutPendingConfirm(withoutDictating(current)),
        effect: {
          kind: "dispatch",
          itemId: dictating.itemId,
          actionId: dictating.actionId,
          payload: { body: dictating.pendingBody },
        },
      };
    }

    case "cancel":
      return { next: {}, effect: { kind: "cancelled" } };

    case "nav":
      return {
        next: withoutPendingConfirm(current),
        effect: { kind: "navigate", directive: intent.directive },
      };

    case "read":
      return {
        next: withoutPendingConfirm(current),
        effect: { kind: "read", target: intent.target },
      };

    case "open":
      return {
        next: withoutPendingConfirm(current),
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
  const pending = session.pendingConfirm;
  if (pending === undefined) {
    return cloneSession(session);
  }

  if (meta.now - Date.parse(pending.armedAt) > meta.confirmTtlMs) {
    return withoutPendingConfirm(session);
  }

  return cloneSession(session);
}

function cloneSession(session: VoiceSession): VoiceSession {
  const next: VoiceSession = {};
  if (session.pendingConfirm !== undefined) {
    next.pendingConfirm = { ...session.pendingConfirm };
  }
  if (session.dictating !== undefined) {
    next.dictating = { ...session.dictating };
  }
  return next;
}

function withoutPendingConfirm(session: VoiceSession): VoiceSession {
  const { pendingConfirm: _pendingConfirm, ...rest } = session;
  const next: VoiceSession = { ...rest };
  if (session.dictating !== undefined) {
    next.dictating = { ...session.dictating };
  }
  return next;
}

function withoutDictating(session: VoiceSession): VoiceSession {
  const { dictating: _dictating, ...rest } = session;
  const next: VoiceSession = { ...rest };
  if (session.pendingConfirm !== undefined) {
    next.pendingConfirm = { ...session.pendingConfirm };
  }
  return next;
}
