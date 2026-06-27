import type { Signal, Source, State } from "./types";

const SOURCES = [
  "github",
  "claude-code",
  "codex",
  "webhook",
  "ntfy",
  "mcp",
] as const satisfies readonly Source[];

const STATES = [
  "working",
  "blocked",
  "needs_review",
  "done",
  "error",
] as const satisfies readonly State[];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null;

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
