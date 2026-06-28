import type { Signal } from "@aspex/schema";

export const OPENCODE_SOURCE = "opencode" as const;

export interface OpenCodeMapOptions {
  serverUrl?: string;
  directory?: string;
}

export type OpenCodeSignal = Signal & {
  source: Signal["source"];
};

export interface OpenCodeHeartbeat {
  kind: "heartbeat";
}

export type OpenCodeMapResult = OpenCodeSignal | OpenCodeHeartbeat | null;

const HEARTBEAT: OpenCodeHeartbeat = { kind: "heartbeat" };

export function mapEvent(
  event: unknown,
  options: OpenCodeMapOptions = {},
): OpenCodeMapResult {
  if (!isRecord(event)) {
    return null;
  }

  const name = eventName(event);

  if (name === "ping" || name === "keepalive") {
    return HEARTBEAT;
  }

  const sessionId = findSessionId(event);

  if (sessionId === undefined) {
    return null;
  }

  const text = classifierText(event);

  if (isBlocked(text)) {
    return {
      ...baseSignal(event, sessionId, options),
      state: "blocked",
      reason: "blocked_on_human",
      attentionRequired: true,
      severity: "high",
      summary: summaryFor(event) ?? "OpenCode needs input",
    };
  }

  if (isErrored(text)) {
    return {
      ...baseSignal(event, sessionId, options),
      state: "error",
      reason: "errored",
      attentionRequired: true,
      severity: "high",
      summary: summaryFor(event) ?? "OpenCode session errored",
    };
  }

  if (isDone(text)) {
    return {
      ...baseSignal(event, sessionId, options),
      state: "done",
      reason: "ambient",
      attentionRequired: false,
      severity: "info",
      summary: summaryFor(event) ?? "OpenCode session finished",
    };
  }

  if (isRunning(text)) {
    return HEARTBEAT;
  }

  return null;
}

export function isHeartbeatResult(
  result: OpenCodeMapResult,
): result is OpenCodeHeartbeat {
  return result !== null && "kind" in result && result.kind === "heartbeat";
}

function baseSignal(
  event: Record<string, unknown>,
  sessionId: string,
  options: OpenCodeMapOptions,
): Omit<OpenCodeSignal, "state"> {
  const directory = stringAt(event, [
    "directory",
    "cwd",
    "project.directory",
    "project.path",
    "session.directory",
    "session.cwd",
  ]);
  const project = projectFromPath(
    directory ??
      stringAt(event, ["project.name", "projectName"]) ??
      options.directory,
  );
  const deepLink =
    stringAt(event, ["deepLink", "url", "session.url"]) ??
    deepLinkFor(options.serverUrl, sessionId) ??
    directory ??
    options.directory;

  return {
    id: openCodeSessionId(sessionId),
    source: OPENCODE_SOURCE as Signal["source"],
    project,
    session: sessionId,
    actor: OPENCODE_SOURCE,
    actions: [],
    deepLink,
    evidence:
      directory === undefined ? [] : [{ label: "Directory", text: directory }],
  };
}

function openCodeSessionId(sessionId: string): string {
  return `${OPENCODE_SOURCE}:session:${sessionId}`;
}

function eventName(event: Record<string, unknown>): string {
  return (
    stringAt(event, ["event", "type", "name", "kind"]) ?? ""
  ).toLowerCase();
}

function classifierText(event: Record<string, unknown>): string {
  const fields = [
    "event",
    "type",
    "name",
    "kind",
    "status",
    "state",
    "phase",
    "reason",
    "category",
    "session.status",
    "session.state",
    "message.status",
    "message.state",
    "data.status",
    "data.state",
    "data.type",
    "data.event",
  ];

  return fields
    .map((path) => stringAt(event, [path]) ?? "")
    .join(" ")
    .toLowerCase();
}

function isBlocked(text: string): boolean {
  return (
    text.includes("blocked") ||
    text.includes("permission") ||
    text.includes("approval") ||
    text.includes("awaiting_input") ||
    text.includes("awaiting input") ||
    text.includes("needs_input") ||
    text.includes("needs input") ||
    text.includes("needs_user") ||
    text.includes("user_input")
  );
}

function isErrored(text: string): boolean {
  return (
    text.includes("error") ||
    text.includes("errored") ||
    text.includes("failed") ||
    text.includes("failure") ||
    text.includes("aborted")
  );
}

function isDone(text: string): boolean {
  return (
    text.includes("completed") ||
    text.includes("complete") ||
    text.includes("finished") ||
    text.includes("done") ||
    text.includes("idle")
  );
}

function isRunning(text: string): boolean {
  return (
    text.includes("running") ||
    text.includes("message") ||
    text.includes("stream") ||
    text.includes("updated") ||
    text.includes("created") ||
    text.includes("started")
  );
}

function findSessionId(event: Record<string, unknown>): string | undefined {
  return stringAt(event, [
    "sessionID",
    "sessionId",
    "session_id",
    "session.id",
    "data.sessionID",
    "data.sessionId",
    "data.session_id",
    "data.session.id",
    "properties.sessionId",
  ]);
}

function summaryFor(event: Record<string, unknown>): string | undefined {
  return stringAt(event, [
    "summary",
    "title",
    "message",
    "error.message",
    "data.summary",
    "data.title",
    "data.message",
    "session.title",
    "session.summary",
  ]);
}

function deepLinkFor(
  serverUrl: string | undefined,
  sessionId: string,
): string | undefined {
  if (serverUrl === undefined || serverUrl.trim().length === 0) {
    return undefined;
  }

  return `${serverUrl.replace(/\/+$/, "")}/session/${encodeURIComponent(sessionId)}`;
}

function projectFromPath(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return OPENCODE_SOURCE;
  }

  const segments = value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);

  return segments.at(-1) ?? OPENCODE_SOURCE;
}

function stringAt(
  value: Record<string, unknown>,
  paths: readonly string[],
): string | undefined {
  for (const path of paths) {
    const found = path
      .split(".")
      .reduce<unknown>(
        (current, key) => (isRecord(current) ? current[key] : undefined),
        value,
      );

    if (typeof found === "string" && found.trim().length > 0) {
      return found.trim();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
