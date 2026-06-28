import type { Intent, ItemId, VoiceContext } from "./index";

export type IntentSource = "grammar" | "freeform";

export interface IntentCandidate {
  itemId: ItemId;
  summary: string;
  actions: string[];
}

export interface IntentRequest {
  text: string;
  context: VoiceContext;
  candidates: IntentCandidate[];
}

export interface IntentResult {
  intent: Intent;
  source: "freeform";
}

export interface FreeformConfig {
  enabled: boolean;
  endpoints: string[];
  model: string;
  timeoutMs: number;
  elevateConfirm: boolean;
}

const DEFAULT_MODEL = "llama3.1";
const DEFAULT_TIMEOUT_MS = 5000;
const FREEFORM_CONFIG_KEYS = [
  "enabled",
  "endpoints",
  "model",
  "timeoutMs",
  "elevateConfirm",
] as const;
const FIRST_STAGE_INTENT_KINDS = [
  "nav",
  "read",
  "open",
  "action",
  "dictate",
  "no_match",
] as const;
const NO_MATCH_REASONS = [
  "low_confidence",
  "unknown_command",
  "no_referent",
  "action_unavailable",
  "ambiguous",
] as const;
const DIRECTIVE_TYPES = [
  "select",
  "move",
  "show_needs_me",
  "open",
  "none",
] as const;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const includesString = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export function parseFreeformConfig(raw: unknown): FreeformConfig {
  if (raw === undefined) {
    return {
      enabled: false,
      endpoints: [],
      model: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      elevateConfirm: true,
    };
  }

  if (!isRecord(raw)) {
    throw new Error("Invalid FreeformConfig");
  }

  for (const key of Object.keys(raw)) {
    if (!includesString(FREEFORM_CONFIG_KEYS, key)) {
      throw new Error("Invalid FreeformConfig");
    }
  }

  const enabled = raw.enabled ?? false;
  const elevateConfirm = raw.elevateConfirm ?? true;
  const model = raw.model ?? DEFAULT_MODEL;
  const timeoutMs = raw.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoints = raw.endpoints ?? [];

  if (
    typeof enabled !== "boolean" ||
    typeof elevateConfirm !== "boolean" ||
    !isNonEmptyString(model) ||
    !isPositiveInteger(timeoutMs) ||
    !isStringArray(endpoints)
  ) {
    throw new Error("Invalid FreeformConfig");
  }

  if (enabled && endpoints.length === 0) {
    throw new Error("Invalid FreeformConfig");
  }

  return {
    enabled,
    endpoints,
    model,
    timeoutMs,
    elevateConfirm,
  };
}

export function isIntentResult(x: unknown): x is IntentResult {
  return isRecord(x) && x.source === "freeform" && isFirstStageIntent(x.intent);
}

function isFirstStageIntent(x: unknown): x is Intent {
  if (!isRecord(x) || !includesString(FIRST_STAGE_INTENT_KINDS, x.kind)) {
    return false;
  }

  switch (x.kind) {
    case "nav":
      return isDirective(x.directive);
    case "read":
    case "open":
      return typeof x.target === "string";
    case "action":
    case "dictate":
      return typeof x.itemId === "string" && typeof x.actionId === "string";
    case "no_match":
      return (
        typeof x.heard === "string" &&
        includesString(NO_MATCH_REASONS, x.reason) &&
        x.reason === "unknown_command"
      );
  }
}

function isDirective(x: unknown): boolean {
  if (!isRecord(x) || !includesString(DIRECTIVE_TYPES, x.type)) {
    return false;
  }

  switch (x.type) {
    case "select":
    case "open":
      return typeof x.id === "string";
    case "move":
      return x.delta === 1 || x.delta === -1;
    case "show_needs_me":
    case "none":
      return true;
  }
}
