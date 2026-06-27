import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Severity } from "@aspex/schema";
import type { LivenessConfig } from "./engine/liveness";

export interface AspexConfig {
  hubPort: number;
  dbPath: string;
  needsMeCap: number;
  pollIntervalMs: number;
  github?: { token: string; allowlist?: string[] };
  ntfy?: { server?: string; topic: string; minSeverity?: "medium" | "high" };
  liveness?: Partial<LivenessConfig>;
  mock?: boolean;
}

type ConfigFile = Partial<Omit<AspexConfig, "github" | "ntfy" | "liveness">> & {
  github?: Partial<AspexConfig["github"]>;
  ntfy?: Partial<AspexConfig["ntfy"]>;
  liveness?: Partial<LivenessConfig>;
};

export const DEFAULT_CONFIG: AspexConfig = {
  hubPort: 4317,
  dbPath: "~/.aspex/aspex.sqlite",
  needsMeCap: 7,
  pollIntervalMs: 60_000,
  liveness: {
    pollGraceMs: 90_000,
    heartbeatGraceMs: 120_000,
    quietAfterMs: 30_000,
    staleAfterMs: 90_000,
    lostAfterMs: 180_000,
  },
};

export const DEFAULT_CONFIG_PATH = "~/.aspex/config.json";

export interface LoadConfigOptions {
  configPath?: string;
  defaultConfigPath?: string;
  env?: NodeJS.ProcessEnv;
  mock?: boolean;
}

export async function loadConfig({
  configPath,
  defaultConfigPath = DEFAULT_CONFIG_PATH,
  env = process.env,
  mock,
}: LoadConfigOptions = {}): Promise<AspexConfig> {
  const path = expandHome(configPath ?? defaultConfigPath);
  const fromFile = await readConfigFile(path, configPath !== undefined);
  const cfg = mergeConfig(DEFAULT_CONFIG, fromFile);
  const withEnv = applyEnv(cfg, env);

  return normalizeConfig({
    ...withEnv,
    mock: mock ?? withEnv.mock,
  });
}

export function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function resolvedLivenessConfig(cfg: AspexConfig): LivenessConfig {
  return {
    ...DEFAULT_CONFIG.liveness,
    ...cfg.liveness,
  } as LivenessConfig;
}

async function readConfigFile(
  path: string,
  required: boolean,
): Promise<ConfigFile> {
  if (!existsSync(path)) {
    if (required) {
      throw new Error(`Config file not found: ${path}`);
    }

    return {};
  }

  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error("Config file must contain a JSON object");
  }

  return parsed;
}

function mergeConfig(base: AspexConfig, override: ConfigFile): AspexConfig {
  return {
    ...base,
    ...override,
    github: mergeOptionalObject(base.github, override.github),
    ntfy: mergeOptionalObject(base.ntfy, override.ntfy),
    liveness: mergeOptionalObject(base.liveness, override.liveness),
  };
}

function applyEnv(cfg: AspexConfig, env: NodeJS.ProcessEnv): AspexConfig {
  const githubToken = optionalNonEmptyEnv(
    env.ASPEX_GITHUB_TOKEN,
    "ASPEX_GITHUB_TOKEN",
  );
  const githubAllowlist = parseCsv(env.ASPEX_GITHUB_ALLOWLIST);
  const ntfyTopic = optionalNonEmptyEnv(
    env.ASPEX_NTFY_TOPIC,
    "ASPEX_NTFY_TOPIC",
  );
  const ntfyServer = optionalNonEmptyEnv(
    env.ASPEX_NTFY_SERVER,
    "ASPEX_NTFY_SERVER",
  );
  const ntfyMinSeverity =
    env.ASPEX_NTFY_MIN_SEVERITY !== undefined
      ? parseNtfySeverity(env.ASPEX_NTFY_MIN_SEVERITY)
      : undefined;
  const github =
    githubToken !== undefined ||
    (cfg.github !== undefined && githubAllowlist !== undefined)
      ? {
          ...(cfg.github ?? { token: githubToken ?? "" }),
          ...(githubToken !== undefined ? { token: githubToken } : {}),
          ...(githubAllowlist !== undefined
            ? { allowlist: githubAllowlist }
            : {}),
        }
      : cfg.github;
  const ntfy =
    ntfyTopic !== undefined ||
    (cfg.ntfy !== undefined &&
      (ntfyServer !== undefined || ntfyMinSeverity !== undefined))
      ? {
          ...(cfg.ntfy ?? { topic: ntfyTopic ?? "" }),
          ...(ntfyServer !== undefined ? { server: ntfyServer } : {}),
          ...(ntfyTopic !== undefined ? { topic: ntfyTopic } : {}),
          ...(ntfyMinSeverity !== undefined
            ? { minSeverity: ntfyMinSeverity }
            : {}),
        }
      : cfg.ntfy;

  return {
    ...cfg,
    hubPort: parseInteger(env.ASPEX_HUB_PORT, cfg.hubPort, "ASPEX_HUB_PORT"),
    dbPath:
      optionalNonEmptyEnv(env.ASPEX_DB_PATH, "ASPEX_DB_PATH") ?? cfg.dbPath,
    needsMeCap: parseInteger(
      env.ASPEX_NEEDS_ME_CAP,
      cfg.needsMeCap,
      "ASPEX_NEEDS_ME_CAP",
    ),
    pollIntervalMs: parseInteger(
      env.ASPEX_POLL_INTERVAL_MS,
      cfg.pollIntervalMs,
      "ASPEX_POLL_INTERVAL_MS",
    ),
    github,
    ntfy,
    mock: parseBoolean(env.ASPEX_MOCK, cfg.mock),
    liveness: {
      ...cfg.liveness,
      pollGraceMs: parseInteger(
        env.ASPEX_LIVENESS_POLL_GRACE_MS,
        cfg.liveness?.pollGraceMs,
        "ASPEX_LIVENESS_POLL_GRACE_MS",
      ),
      heartbeatGraceMs: parseInteger(
        env.ASPEX_LIVENESS_HEARTBEAT_GRACE_MS,
        cfg.liveness?.heartbeatGraceMs,
        "ASPEX_LIVENESS_HEARTBEAT_GRACE_MS",
      ),
      quietAfterMs: parseInteger(
        env.ASPEX_LIVENESS_QUIET_AFTER_MS,
        cfg.liveness?.quietAfterMs,
        "ASPEX_LIVENESS_QUIET_AFTER_MS",
      ),
      staleAfterMs: parseInteger(
        env.ASPEX_LIVENESS_STALE_AFTER_MS,
        cfg.liveness?.staleAfterMs,
        "ASPEX_LIVENESS_STALE_AFTER_MS",
      ),
      lostAfterMs: parseInteger(
        env.ASPEX_LIVENESS_LOST_AFTER_MS,
        cfg.liveness?.lostAfterMs,
        "ASPEX_LIVENESS_LOST_AFTER_MS",
      ),
    },
  };
}

function normalizeConfig(cfg: AspexConfig): AspexConfig {
  const normalized = {
    ...cfg,
    dbPath: expandHome(cfg.dbPath),
  };

  if (normalized.github !== undefined) {
    requireNonEmptySectionField(
      normalized.github.token,
      "github.token",
      "github",
    );
  }

  if (normalized.ntfy !== undefined) {
    requireNonEmptySectionField(normalized.ntfy.topic, "ntfy.topic", "ntfy");
  }

  return normalized;
}

function parseInteger(
  raw: string | undefined,
  fallback: number | undefined,
  name: string,
): number {
  if (raw === undefined) {
    if (fallback === undefined) {
      throw new Error(`${name} is required`);
    }

    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseBoolean(
  raw: string | undefined,
  fallback: boolean | undefined,
): boolean | undefined {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.toLowerCase();

  if (normalized === "true" || raw === "1") {
    return true;
  }

  if (normalized === "false" || raw === "0") {
    return false;
  }

  throw new Error("ASPEX_MOCK must be true, false, 1, or 0");
}

function parseNtfySeverity(raw: string): Extract<Severity, "medium" | "high"> {
  if (raw === "medium" || raw === "high") {
    return raw;
  }

  throw new Error("ASPEX_NTFY_MIN_SEVERITY must be medium or high");
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function optionalNonEmptyEnv(
  raw: string | undefined,
  name: string,
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return trimmed;
}

function requireNonEmptySectionField(
  value: unknown,
  field: string,
  section: string,
): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${field} must be a non-empty string when ${section} is configured`,
    );
  }
}

function mergeOptionalObject<T extends object>(
  base: T | undefined,
  override: Partial<T> | undefined,
): T | undefined {
  if (override === undefined) {
    return base;
  }

  return {
    ...(base ?? {}),
    ...override,
  } as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
