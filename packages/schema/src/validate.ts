import { isRecord } from "./guards";
import type { Signal, Source, State } from "./types";

const SOURCES = [
  "github",
  "claude-code",
  "codex",
  "opencode",
  "cursor",
  "webhook",
  "ntfy",
  "mcp",
  "orchestrator",
] as const satisfies readonly Source[];

const STATES = [
  "working",
  "blocked",
  "needs_review",
  "done",
  "error",
] as const satisfies readonly State[];

const includesString = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

export function isValidSignal(x: unknown): x is Signal {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    x.id.length > 0 &&
    includesString(SOURCES, x.source) &&
    includesString(STATES, x.state)
  );
}

export function assertSignal(x: unknown): asserts x is Signal {
  if (!isValidSignal(x)) {
    throw new Error("Invalid Signal");
  }
}
