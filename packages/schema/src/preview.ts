import type { ItemId } from "./index";

export type PreviewTrust = "trusted" | "untrusted";
export type PreviewState = "booting" | "ready" | "crashed" | "stopped";
export type PreviewEngineKind = "docker" | "compose" | "mock";

export interface PreviewSpec {
  id: string;
  name: string;
  engine: PreviewEngineKind;
  image?: string;
  composeFile?: string;
  port: number;
  trust: PreviewTrust;
  itemId?: ItemId;
  /** Preview env must never carry secrets. */
  env?: Record<string, string>;
  limits?: { cpus?: string; memory?: string; idleTtlSec?: number };
}

export interface Preview {
  previewId: string;
  specId: string;
  state: PreviewState;
  trust: PreviewTrust;
  url?: string;
  startedAt: string;
  expiresAt?: string;
  message?: string;
}

const PREVIEW_TRUSTS = ["trusted", "untrusted"] as const;
const PREVIEW_ENGINES = ["docker", "compose", "mock"] as const;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const includesString = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isStringRecord = (x: unknown): x is Record<string, string> =>
  isRecord(x) && Object.values(x).every((value) => typeof value === "string");

const isPort = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 65535;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

function parseLimits(limits: unknown): NonNullable<PreviewSpec["limits"]> {
  if (limits === undefined) {
    return {};
  }

  if (!isRecord(limits)) {
    throw new Error("Invalid PreviewSpec");
  }

  const parsed: NonNullable<PreviewSpec["limits"]> = {};

  if (limits.cpus !== undefined) {
    if (!isNonEmptyString(limits.cpus)) {
      throw new Error("Invalid PreviewSpec");
    }
    parsed.cpus = limits.cpus;
  }

  if (limits.memory !== undefined) {
    if (!isNonEmptyString(limits.memory)) {
      throw new Error("Invalid PreviewSpec");
    }
    parsed.memory = limits.memory;
  }

  if (limits.idleTtlSec !== undefined) {
    if (!isPositiveInteger(limits.idleTtlSec)) {
      throw new Error("Invalid PreviewSpec");
    }
    parsed.idleTtlSec = limits.idleTtlSec;
  }

  return parsed;
}

export function parsePreviewSpec(raw: unknown): PreviewSpec {
  if (!isRecord(raw)) {
    throw new Error("Invalid PreviewSpec");
  }

  const hasImage = raw.image !== undefined;
  const hasComposeFile = raw.composeFile !== undefined;

  if (
    !isNonEmptyString(raw.id) ||
    !isNonEmptyString(raw.name) ||
    !includesString(PREVIEW_ENGINES, raw.engine) ||
    !isPort(raw.port) ||
    !includesString(PREVIEW_TRUSTS, raw.trust) ||
    hasImage === hasComposeFile
  ) {
    throw new Error("Invalid PreviewSpec");
  }

  if (hasImage && !isNonEmptyString(raw.image)) {
    throw new Error("Invalid PreviewSpec");
  }

  if (hasComposeFile && !isNonEmptyString(raw.composeFile)) {
    throw new Error("Invalid PreviewSpec");
  }

  if (raw.itemId !== undefined && !isNonEmptyString(raw.itemId)) {
    throw new Error("Invalid PreviewSpec");
  }

  if (raw.env !== undefined && !isStringRecord(raw.env)) {
    throw new Error("Invalid PreviewSpec");
  }

  const image = typeof raw.image === "string" ? raw.image : undefined;
  const composeFile =
    typeof raw.composeFile === "string" ? raw.composeFile : undefined;

  const spec: PreviewSpec = {
    id: raw.id,
    name: raw.name,
    engine: raw.engine,
    port: raw.port,
    trust: raw.trust,
    limits: parseLimits(raw.limits),
  };

  if (image !== undefined) {
    spec.image = image;
  }

  if (composeFile !== undefined) {
    spec.composeFile = composeFile;
  }

  if (raw.itemId !== undefined) {
    spec.itemId = raw.itemId;
  }

  if (raw.env !== undefined) {
    spec.env = raw.env;
  }

  return spec;
}

export function isPreviewSpec(x: unknown): x is PreviewSpec {
  try {
    parsePreviewSpec(x);
    return true;
  } catch {
    return false;
  }
}
