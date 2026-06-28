import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
  Signal,
} from "@aspex/schema";
import { claudeSessionId } from "@aspex/schema";

export const CLAUDE_CODE_SOURCE = "claude-code" as const;
export const CLAUDE_CODE_HOOK_EVENTS = [
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
] as const;

export type ClaudeCodeHookEvent = (typeof CLAUDE_CODE_HOOK_EVENTS)[number];

export interface ClaudeHookPayload {
  session_id?: unknown;
  transcript_path?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
  tool_name?: unknown;
  message?: unknown;
}

export type ClaudeCodeSignal = Signal & {
  heartbeat?: true;
};

export class ClaudeCodeAdapter implements Adapter {
  id = CLAUDE_CODE_SOURCE;

  async start(_ctx: AdapterContext): Promise<void> {}

  listActions(_itemId: string): Action[] {
    return [];
  }

  async runAction(
    _itemId: string,
    _actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    return { ok: false, message: "read-only in Phase 0" };
  }

  async stop(): Promise<void> {}
}

export function mapClaudeHookToSignal(
  event: string,
  payload: ClaudeHookPayload,
): ClaudeCodeSignal | null {
  const sessionId = stringField(payload.session_id);

  if (sessionId === undefined) {
    return null;
  }

  const cwd = stringField(payload.cwd);
  const transcriptPath = stringField(payload.transcript_path);
  const project =
    cwd === undefined || cwd.trim() === "" ? "" : projectFromCwd(cwd);
  const deepLink = cwd ?? transcriptPath;
  const base = {
    id: claudeSessionId(sessionId),
    source: CLAUDE_CODE_SOURCE,
    project,
    session: sessionId,
    actor: "claude-code",
    actions: [],
    deepLink,
    evidence: evidenceFor(payload),
  } satisfies Partial<ClaudeCodeSignal>;

  if (event === "Notification") {
    const message = stringField(payload.message);

    return {
      ...base,
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      severity: "high",
      summary:
        message === undefined || message.trim() === ""
          ? "Claude Code needs input"
          : message,
    };
  }

  if (event === "Stop" || event === "SubagentStop") {
    return {
      ...base,
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      summary:
        event === "Stop"
          ? "Claude Code session finished"
          : "Claude Code subagent finished",
    };
  }

  if (event === "PostToolUse") {
    const toolName = stringField(payload.tool_name);

    return {
      ...base,
      state: "working",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      summary:
        toolName === undefined || toolName.trim() === ""
          ? "Claude Code is working"
          : `Claude Code used ${toolName}`,
      heartbeat: true,
    };
  }

  return null;
}

function evidenceFor(payload: ClaudeHookPayload): ClaudeCodeSignal["evidence"] {
  const transcriptPath = stringField(payload.transcript_path);

  return transcriptPath === undefined
    ? []
    : [{ label: "Transcript", text: transcriptPath }];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Claude Code may report a Windows (`D:\a\b`) or POSIX (`/a/b`) cwd regardless of
// the OS the Hub runs on, so derive the project label by splitting on both
// separators rather than relying on the platform-specific node:path basename
// (which only treats `\` as a separator on Windows, mis-deriving a Windows path
// to the whole string on a Linux host).
function projectFromCwd(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? "";
}

export * from "./hooks-install";
export * from "./relay";
