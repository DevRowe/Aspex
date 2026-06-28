import type { ItemId } from "./index";

// Attached by the client to every Utterance so the Hub can resolve referents (ADR-0011).
export interface VoiceContext {
  selectedId?: ItemId;
  needsMeIds: ItemId[];
}

export interface Transcript {
  text: string;
  confidence: number;
}

// What the pure parser produces. (card 25)
export type Intent =
  | { kind: "nav"; directive: ClientDirective }
  | { kind: "read"; target: ItemId }
  | { kind: "open"; target: ItemId }
  | { kind: "action"; itemId: ItemId; actionId: string }
  | { kind: "confirm"; itemId: ItemId; actionId: string }
  | { kind: "dictate"; itemId: ItemId; actionId: string }
  | { kind: "dictation_body"; text: string }
  | { kind: "post" }
  | { kind: "cancel" }
  | { kind: "no_match"; heard: string; reason: NoMatchReason };

export type NoMatchReason =
  | "low_confidence"
  | "unknown_command"
  | "no_referent"
  | "action_unavailable"
  | "ambiguous";

export type ClientDirective =
  | { type: "select"; id: ItemId }
  | { type: "move"; delta: 1 | -1 }
  | { type: "show_needs_me" }
  | { type: "open"; id: ItemId }
  | { type: "none" };

// Pure session state carried between Utterances (card 26).
export interface VoiceSession {
  pendingConfirm?: {
    itemId: ItemId;
    actionId: string;
    label: string;
    armedAt: string;
  };
  dictating?: { itemId: ItemId; actionId: string; pendingBody?: string };
}

// What POST /voice/utterance returns (card 28).
export interface VoiceResult {
  ok: boolean;
  readback: string;
  audioUrl?: string;
  directive?: ClientDirective;
  session: VoiceSession;
}

const DIRECTIVE_TYPES = [
  "select",
  "move",
  "show_needs_me",
  "open",
  "none",
] as const;
const MOVE_DELTAS = [1, -1] as const;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

const includesString = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

const includesNumber = <T extends number>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "number" && values.includes(value as T);

const isStringArray = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((value) => typeof value === "string");

export function isValidVoiceContext(x: unknown): x is VoiceContext {
  return (
    isRecord(x) &&
    isStringArray(x.needsMeIds) &&
    (x.selectedId === undefined || typeof x.selectedId === "string")
  );
}

export function assertVoiceContext(x: unknown): asserts x is VoiceContext {
  if (!isValidVoiceContext(x)) {
    throw new Error("Invalid VoiceContext");
  }
}

export function isDirective(x: unknown): x is ClientDirective {
  if (!isRecord(x) || !includesString(DIRECTIVE_TYPES, x.type)) {
    return false;
  }

  switch (x.type) {
    case "select":
    case "open":
      return typeof x.id === "string";
    case "move":
      return includesNumber(MOVE_DELTAS, x.delta);
    case "show_needs_me":
    case "none":
      return true;
  }
}
