import type { Signal } from "@aspex/schema";
import { cursorAgentId, isRecord, stringAt } from "@aspex/schema";

export const CURSOR_SOURCE = "cursor" as const;

export type CursorStatus = "ERROR" | "FINISHED";

export interface CursorStatusChange {
  type?: unknown;
  event?: unknown;
  statusChange?: unknown;
  status?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  id?: unknown;
  project?: unknown;
  repository?: unknown;
  repo?: unknown;
  summary?: unknown;
  title?: unknown;
  message?: unknown;
  deepLink?: unknown;
  url?: unknown;
  agentUrl?: unknown;
  error?: unknown;
}

export type CursorSignal = Omit<Signal, "source"> & {
  source: typeof CURSOR_SOURCE;
};

export function mapCursorStatusChangeToSignal(
  payload: unknown,
): CursorSignal | null {
  if (!isRecord(payload)) {
    return null;
  }

  const status = statusField(payload);
  const agentId = stringAt(payload, ["agentId", "agent_id", "id"]);

  if (status === undefined || agentId === undefined) {
    return null;
  }

  const base = {
    id: cursorAgentId(agentId),
    source: CURSOR_SOURCE,
    project:
      stringAt(payload, ["project", "repository", "repo"]) ?? CURSOR_SOURCE,
    session: agentId,
    actor: CURSOR_SOURCE,
    actions: [],
    deepLink: stringAt(payload, ["deepLink", "url", "agentUrl"]),
    summary: summaryFor(payload, status),
  } satisfies Omit<CursorSignal, "state">;

  if (status === "ERROR") {
    return {
      ...base,
      state: "error",
      reason: "errored",
      attentionRequired: true,
      severity: "high",
    };
  }

  return {
    ...base,
    state: "done",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
  };
}

function statusField(
  payload: Record<string, unknown>,
): CursorStatus | undefined {
  const raw = stringAt(payload, ["statusChange", "status"]);
  const normalized = raw?.toUpperCase();

  return normalized === "ERROR" || normalized === "FINISHED"
    ? normalized
    : undefined;
}

function summaryFor(
  payload: Record<string, unknown>,
  status: CursorStatus,
): string {
  return (
    stringAt(payload, ["summary", "title", "message", "error.message"]) ??
    (status === "ERROR" ? "Cursor agent errored" : "Cursor agent finished")
  );
}
