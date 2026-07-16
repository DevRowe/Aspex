// Shared primitive guards and extractors. Adapters and the Hub all parse
// loosely-typed payloads (hook JSON, webhook bodies, REST responses); these
// are the single home for those primitives so the copies cannot drift.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Non-empty string, returned as-is (no trimming).
export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Trimmed non-blank string; use for payloads where surrounding whitespace is
// noise rather than content.
export function trimmedStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

// First trimmed non-blank string found at any of the dotted paths.
export function stringAt(
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

// Agents may report a Windows (`D:\a\b`) or POSIX (`/a/b`) cwd regardless of
// the OS the Hub runs on, so derive the project label by splitting on both
// separators rather than relying on the platform-specific node:path basename
// (which only treats `\` as a separator on Windows, mis-deriving a Windows
// path to the whole string on a Linux host).
export function projectFromCwd(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? "";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
