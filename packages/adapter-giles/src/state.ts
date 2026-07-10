// Read-only parsers over Giles's team-state files. The adapter reads
// data/backlog.md for the task list, state/<id>.meta for task metadata, and
// shells bin/giles-worker-state.sh for the authoritative CURRENT state -
// never a tail of the append-only status log (Giles AGENTS.md section 8).

export interface GilesTaskRef {
  taskId: string;
  title: string;
  repo?: string;
  kind?: string;
}

export type GilesWorkerStateName =
  | "working"
  | "parked"
  | "done"
  | "blocked"
  | "failed"
  | "unknown";

export interface GilesWorkerState {
  state: GilesWorkerStateName;
  source: string;
  detail: string;
}

export type GilesStatusVerb =
  | "working"
  | "needs-decision"
  | "blocked"
  | "done"
  | "failed";

export interface GilesStatusEvent {
  verb: GilesStatusVerb;
  text: string;
}

// Giles task ids are safe slugs; refuse anything that could not have been
// minted by Giles before composing file paths or argv from it.
export function isValidGilesTaskId(id: unknown): id is string {
  return (
    typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)
  );
}

const IN_FLIGHT_HEADING = /^##\s+In flight\s*$/;
const HEADING = /^##\s+/;
const TASK_LINE = /^- \[ \] (\S+) - (.*)$/;

// A missing backlog file or a mid-rewrite partial read yields content without
// the heading; callers use this to tell "no tasks" apart from "no data".
export function hasInFlightSection(markdown: string): boolean {
  return markdown.split("\n").some((line) => IN_FLIGHT_HEADING.test(line));
}

export function parseBacklogInFlight(markdown: string): GilesTaskRef[] {
  const refs: GilesTaskRef[] = [];
  let inFlight = false;

  for (const line of markdown.split("\n")) {
    if (IN_FLIGHT_HEADING.test(line)) {
      inFlight = true;
      continue;
    }

    if (HEADING.test(line)) {
      inFlight = false;
      continue;
    }

    if (!inFlight) {
      continue;
    }

    const match = TASK_LINE.exec(line);

    if (match === null) {
      // Continuation/annotation lines under a task are not tasks.
      continue;
    }

    const taskId = match[1];
    const rawTitle = match[2];

    if (
      taskId === undefined ||
      rawTitle === undefined ||
      !isValidGilesTaskId(taskId)
    ) {
      continue;
    }

    refs.push({
      taskId,
      title: cleanTitle(rawTitle),
      ...(extractAnnotation(rawTitle, "repo") !== undefined
        ? { repo: extractAnnotation(rawTitle, "repo") }
        : {}),
      ...(extractAnnotation(rawTitle, "kind") !== undefined
        ? { kind: extractAnnotation(rawTitle, "kind") }
        : {}),
    });
  }

  return refs;
}

function extractAnnotation(title: string, key: string): string | undefined {
  const match = new RegExp(`\\(${key}:\\s*([^)]+)\\)`).exec(title);
  const value = match?.[1]?.trim();

  return value === undefined || value === "" ? undefined : value;
}

function cleanTitle(rawTitle: string): string {
  return rawTitle
    .replace(/\s*blocked-by:\s*\S+/g, "")
    .replace(/\s*\((?:repo|kind):[^)]*\)/g, "")
    .replace(/\s*\((?:since|merged|done|reported)\b[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// One line: `state: <name> · source: <src> · <detail>`.
const WORKER_STATE_LINE =
  /^state:\s*(working|parked|done|blocked|failed|unknown)\s*·\s*source:\s*([^·]*?)\s*(?:·\s*([\s\S]*))?$/;

export function parseWorkerStateLine(line: string): GilesWorkerState | null {
  const match = WORKER_STATE_LINE.exec(line.trim());

  if (match === null) {
    return null;
  }

  return {
    state: match[1] as GilesWorkerStateName,
    source: match[2]?.trim() ?? "",
    detail: match[3]?.trim() ?? "",
  };
}

export function parseMeta(text: string): Record<string, string> {
  const meta: Record<string, string> = {};

  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (key !== "") {
      meta[key] = value;
    }
  }

  return meta;
}

const STATUS_LINE = /^(working|needs-decision|blocked|done|failed):\s*(.*)$/;

// Last wake event in the append-only status log. This is NEVER current-state
// truth; it only disambiguates a parked worker (needs-decision/blocked vs a
// no-mistakes gate) and supplies the human-written note.
export function lastStatusEvent(text: string): GilesStatusEvent | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];

    if (line === undefined) {
      continue;
    }

    const match = STATUS_LINE.exec(line);

    if (match !== null) {
      return {
        verb: match[1] as GilesStatusVerb,
        text: match[2]?.trim() ?? "",
      };
    }
  }

  return null;
}
