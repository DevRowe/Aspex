import type { AttentionItem } from "@aspex/schema";

export interface RankedState {
  needsMe: AttentionItem[];
  overflow: AttentionItem[];
  ambient: AttentionItem[];
  generatedAt: string;
}

export type ConnectionPhase =
  | "unconfigured"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "stale"
  | "auth_failed"
  | "malformed";

export interface ConnectionState {
  phase: ConnectionPhase;
  detail: string;
  attempt: number;
  lastStateAt?: string;
}

const STATES = new Set(["working", "blocked", "needs_review", "done", "error"]);
const LIVENESS = new Set(["live", "quiet", "stale", "lost"]);
const REASONS = new Set([
  "blocked_on_human",
  "failing_ci",
  "review_requested",
  "awaiting_merge",
  "errored",
  "ambient",
]);
const SEVERITIES = new Set(["info", "low", "medium", "high"]);

export function parseRankedState(value: unknown): RankedState {
  if (!isRecord(value)) {
    throw new Error("Snapshot is not an object");
  }

  const needsMe = parseItems(value.needsMe, "needsMe");
  const overflow = parseItems(value.overflow, "overflow");
  const ambient = parseItems(value.ambient, "ambient");
  if (
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    throw new Error("Snapshot generatedAt is invalid");
  }

  return { needsMe, overflow, ambient, generatedAt: value.generatedAt };
}

function parseItems(value: unknown, field: string): AttentionItem[] {
  if (!Array.isArray(value)) {
    throw new Error(`Snapshot ${field} is not an array`);
  }
  if (!value.every(isAttentionItem)) {
    throw new Error(`Snapshot ${field} contains a malformed item`);
  }
  return value;
}

function isAttentionItem(value: unknown): value is AttentionItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.project === "string" &&
    typeof value.summary === "string" &&
    typeof value.state === "string" &&
    STATES.has(value.state) &&
    typeof value.liveness === "string" &&
    LIVENESS.has(value.liveness) &&
    typeof value.reason === "string" &&
    REASONS.has(value.reason) &&
    typeof value.severity === "string" &&
    SEVERITIES.has(value.severity) &&
    typeof value.attentionRequired === "boolean" &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidence) &&
    Array.isArray(value.actions) &&
    value.actions.every(isAction) &&
    typeof value.observedAt === "string" &&
    typeof value.staleAfter === "string"
  );
}

function isEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.url === undefined || typeof value.url === "string")
  );
}

function isAction(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.risk === "string" &&
    typeof value.requiresConfirmation === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
