import type { Signal } from "@aspex/schema";
import {
  codexSessionId,
  isRecord,
  projectFromCwd,
  stringField,
} from "@aspex/schema";

const CODEX_SOURCE = "codex";

export interface CodexNotifyPayload {
  type?: unknown;
  "thread-id"?: unknown;
  thread_id?: unknown;
  cwd?: unknown;
  path?: unknown;
  url?: unknown;
  "session-url"?: unknown;
  session_url?: unknown;
  "session-path"?: unknown;
  session_path?: unknown;
}

export type CodexSignal = Signal & {
  heartbeat?: true;
};

export function mapCodexNotifyToSignal(payload: unknown): CodexSignal | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (stringField(payload.type) !== "agent-turn-complete") {
    return null;
  }

  const threadId =
    stringField(payload["thread-id"]) ?? stringField(payload.thread_id);

  if (threadId === undefined) {
    return null;
  }

  const cwd = stringField(payload.cwd);
  const deepLink =
    cwd ??
    stringField(payload["session-url"]) ??
    stringField(payload.session_url) ??
    stringField(payload["session-path"]) ??
    stringField(payload.session_path) ??
    stringField(payload.path) ??
    stringField(payload.url);

  return {
    id: codexSessionId(threadId),
    source: CODEX_SOURCE,
    project: cwd === undefined || cwd.trim() === "" ? "" : projectFromCwd(cwd),
    session: threadId,
    actor: "codex",
    state: "done",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
    summary: "Codex turn completed",
    actions: [],
    deepLink,
    evidence:
      deepLink === undefined
        ? []
        : [{ label: "Codex session", text: deepLink }],
    heartbeat: true,
  };
}
