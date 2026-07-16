import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isRecord } from "@aspex/schema";
import { z } from "zod";
import type { LivenessConfig } from "./engine/liveness";

export function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

// --- schema primitives -----------------------------------------------------
// Error messages are written without their config path; configParseError
// prefixes each issue with its dotted path (and the matching env var, if any),
// e.g. "intent.timeoutMs must be a positive integer (env ...)".

const positiveInt = (message = "must be a positive integer") =>
  z.number({ error: message }).int(message).positive(message);

const configBoolean = z.boolean({ error: "must be a boolean" });

const requiredString = (message: string) =>
  z.string({ error: message }).refine((value) => value.trim() !== "", message);

// Reduce a URL to its base form: no trailing slash, query, or fragment.
function baseUrlOrUndefined(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

// Append the voice contract path (/transcribe or /speak) to a base URL,
// keeping it when the endpoint already ends with it.
function contractUrlOrUndefined(
  endpoint: string,
  contractPath: "/transcribe" | "/speak",
): string | undefined {
  try {
    const url = new URL(endpoint);
    const trimmedPath = url.pathname.replace(/\/+$/, "");

    if (trimmedPath === "" || trimmedPath === "/") {
      url.pathname = contractPath;
    } else if (trimmedPath.endsWith(contractPath)) {
      url.pathname = trimmedPath;
    } else {
      url.pathname = `${trimmedPath}${contractPath}`;
    }

    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const endpointList = (normalize: (endpoint: string) => string | undefined) =>
  z
    .array(z.unknown(), { error: "must be an array" })
    .transform((endpoints, ctx) => {
      const normalized: string[] = [];

      for (const endpoint of endpoints) {
        if (typeof endpoint !== "string" || endpoint.trim() === "") {
          ctx.addIssue({
            code: "custom",
            message: "must contain non-empty strings",
          });
          return z.NEVER;
        }

        const url = normalize(endpoint);

        if (url === undefined) {
          ctx.addIssue({ code: "custom", message: "must contain valid URLs" });
          return z.NEVER;
        }

        normalized.push(url);
      }

      return normalized;
    });

// --- section schemas -------------------------------------------------------

const voiceSchema = z
  .object({
    enabled: configBoolean.default(false),
    stt: z
      .object({
        endpoints: endpointList((endpoint) =>
          contractUrlOrUndefined(endpoint, "/transcribe"),
        ).default(["http://127.0.0.1:8901/transcribe"]),
        timeoutMs: positiveInt().default(5000),
      })
      .prefault({}),
    tts: z
      .object({
        endpoint: requiredString("must be a non-empty string when set")
          .transform((endpoint, ctx) => {
            const url = contractUrlOrUndefined(endpoint, "/speak");

            if (url === undefined) {
              ctx.addIssue({
                code: "custom",
                message: "must contain valid URLs",
              });
              return z.NEVER;
            }

            return url;
          })
          .optional(),
      })
      .prefault({}),
    confidenceThreshold: z
      .number({ error: "must be between 0 and 1" })
      .min(0, "must be between 0 and 1")
      .max(1, "must be between 0 and 1")
      .default(0.6),
    confirmTtlMs: positiveInt().default(8000),
    pttKey: requiredString("must be a non-empty string").default("Space"),
    mock: configBoolean.optional(),
  })
  .superRefine((voice, ctx) => {
    if (
      voice.enabled &&
      voice.mock !== true &&
      voice.stt.endpoints.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["stt", "endpoints"],
        message: "must contain at least one endpoint when voice is enabled",
      });
    }
  })
  .prefault({});

const intentSchema = z
  .object({
    enabled: configBoolean.default(false),
    endpoints: endpointList(baseUrlOrUndefined).default([
      "http://127.0.0.1:11434",
    ]),
    model: requiredString("must be a non-empty string")
      .transform((model) => model.trim())
      .default("llama3.1"),
    timeoutMs: positiveInt().default(8000),
    elevateConfirm: configBoolean.default(true),
    mock: configBoolean.optional(),
  })
  .superRefine((intent, ctx) => {
    if (
      intent.enabled &&
      intent.mock !== true &&
      intent.endpoints.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endpoints"],
        message: "must contain at least one endpoint when intent is enabled",
      });
    }
  })
  .prefault({});

const adaptersSchema = z
  .object({
    codex: z.object({ enabled: configBoolean.default(false) }).prefault({}),
    opencode: z
      .object({
        enabled: configBoolean.default(false),
        serverUrl: z.string().default("http://127.0.0.1:4096"),
        directory: requiredString("must be a non-empty string when set")
          .transform((directory) => directory.trim())
          .optional(),
      })
      .prefault({})
      // The serverUrl is only contractual while the adapter is enabled; a
      // disabled section passes through untouched.
      .transform((opencode, ctx) => {
        if (!opencode.enabled) {
          return opencode;
        }

        const trimmed = opencode.serverUrl.trim();
        const url = trimmed === "" ? undefined : baseUrlOrUndefined(trimmed);

        if (url === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["serverUrl"],
            message: "must be a non-empty valid URL when opencode is enabled",
          });
          return z.NEVER;
        }

        return { ...opencode, serverUrl: url };
      }),
    cursor: z
      .object({
        enabled: configBoolean.default(false),
        secret: z
          .string()
          .transform((secret) => secret.trim())
          .optional(),
      })
      .prefault({})
      .superRefine((cursor, ctx) => {
        if (
          cursor.enabled &&
          (cursor.secret === undefined || cursor.secret === "")
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["secret"],
            message: "must be a non-empty string when cursor is enabled",
          });
        }
      }),
  })
  .prefault({});

const orchestratorsSchema = z
  .object({
    giles: z
      .object({
        enabled: configBoolean.default(false),
        // The Giles home directory the adapter reads (and whose designated
        // state/aspex-inbox it delivers intents into).
        home: requiredString("must be a non-empty path")
          .transform((home) => expandHome(home.trim()))
          .prefault("~/giles"),
        pollIntervalMs: positiveInt(
          "must be a positive integer when set",
        ).optional(),
      })
      .prefault({}),
  })
  .prefault({});

const livenessSchema = z
  .object({
    pollGraceMs: positiveInt().default(90_000),
    heartbeatGraceMs: positiveInt().default(120_000),
    quietAfterMs: positiveInt().default(30_000),
    staleAfterMs: positiveInt().default(90_000),
    lostAfterMs: positiveInt().default(180_000),
  })
  .prefault({});

export const aspexConfigSchema = z.object({
  hubPort: positiveInt().default(4317),
  // Interface the Hub HTTP server binds to (ADR-0023 tailnet model): loopback
  // by default; set to the dev box's tailnet address to serve enrolled
  // devices (the glasses). Never a public interface by default.
  hubBind: requiredString("must be a non-empty host or address")
    .transform((bind) => bind.trim())
    .default("127.0.0.1"),
  // One extra exact origin allowed by CORS, e.g. the XR lab client's
  // origin, alongside the built-in tauri://localhost and http://localhost:*.
  corsOrigin: z
    .string({ error: "must be a non-empty origin when set" })
    .transform((origin, ctx) => {
      if (origin.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: "must be a non-empty origin when set",
        });
        return z.NEVER;
      }

      try {
        return new URL(origin.trim()).origin;
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "must be a valid origin, e.g. http://hl2.tailnet:8080",
        });
        return z.NEVER;
      }
    })
    .optional(),
  // Optional TLS for the Hub's tailnet exposure (docs/hub-api.md "TLS"):
  // Snap requires wss/https to publish, and Meta web apps plus Chrome Local
  // Network Access push the same way. Point at a PEM cert/key pair, e.g. the
  // output of `tailscale cert <machine>.<tailnet>.ts.net`. Off by default;
  // loopback development stays plain http.
  tls: z
    .object({
      certPath: z.string({ error: "must be a string" }).default(""),
      keyPath: z.string({ error: "must be a string" }).default(""),
    })
    .transform((tls, ctx) => {
      const certPath = tls.certPath.trim();
      const keyPath = tls.keyPath.trim();

      if (certPath === "" || keyPath === "") {
        ctx.addIssue({
          code: "custom",
          message:
            "requires both certPath and keyPath (PEM files, e.g. from `tailscale cert`)",
        });
        return z.NEVER;
      }

      return { certPath: expandHome(certPath), keyPath: expandHome(keyPath) };
    })
    .optional(),
  dbPath: requiredString("must be a non-empty string")
    .transform(expandHome)
    .prefault("~/.aspex/aspex.sqlite"),
  needsMeCap: positiveInt().default(7),
  pollIntervalMs: positiveInt().default(60_000),
  auth: z
    .object({
      token: requiredString(
        "must be a non-empty string when auth is configured",
      ),
    })
    .optional(),
  github: z
    .object({
      token: requiredString(
        "must be a non-empty string when github is configured",
      ),
      allowlist: z.array(z.string()).optional(),
    })
    .optional(),
  ntfy: z
    .object({
      server: z.string().optional(),
      topic: requiredString(
        "must be a non-empty string when ntfy is configured",
      ),
      minSeverity: z
        .enum(["medium", "high"], { error: "must be medium or high" })
        .optional(),
    })
    .optional(),
  liveness: livenessSchema,
  voice: voiceSchema,
  intent: intentSchema,
  adapters: adaptersSchema,
  orchestrators: orchestratorsSchema,
  mock: configBoolean.optional(),
});

export type AspexConfig = z.infer<typeof aspexConfigSchema>;
export type VoiceConfig = AspexConfig["voice"];
export type IntentConfig = AspexConfig["intent"];
export type AdaptersConfig = AspexConfig["adapters"];
export type OrchestratorsConfig = AspexConfig["orchestrators"];

export const DEFAULT_CONFIG: AspexConfig = aspexConfigSchema.parse({});

export const DEFAULT_CONFIG_PATH = "~/.aspex/config.json";

// --- environment overrides -------------------------------------------------
// Each env var maps to one dotted config path plus a coercion schema; the
// coerced value is layered onto the parsed config file before the final
// schema.parse. `requiresSection` marks partials that must not conjure an
// optional section on their own (the section's primary var, listed first,
// creates it).

const envString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value !== "", "must be a non-empty string");

const envPositiveInt = z
  .string()
  .transform(Number)
  .refine(
    (value) => Number.isInteger(value) && value > 0,
    "must be a positive integer",
  );

const envNumber = z
  .string()
  .transform(Number)
  .refine((value) => Number.isFinite(value), "must be a number");

const envBoolean = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine(
    (value) => ["true", "1", "false", "0"].includes(value),
    "must be a boolean (true, false, 1, or 0)",
  )
  .transform((value) => value === "true" || value === "1");

const envCsv = z.string().transform((value) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
);

const envSeverity = z.enum(["medium", "high"], {
  error: "must be medium or high",
});

// [env var, dotted config path, coercion, section that must already exist]
type EnvOverride = [string, string, z.ZodType, ("github" | "ntfy")?];

// biome-ignore format: keep one env var per line
const ENV_OVERRIDES: EnvOverride[] = [
  ["ASPEX_HUB_PORT", "hubPort", envPositiveInt],
  ["ASPEX_HUB_BIND", "hubBind", envString],
  ["ASPEX_HUB_CORS_ORIGIN", "corsOrigin", envString],
  ["ASPEX_HUB_TOKEN", "auth.token", envString],
  ["ASPEX_HUB_TLS_CERT", "tls.certPath", envString],
  ["ASPEX_HUB_TLS_KEY", "tls.keyPath", envString],
  ["ASPEX_DB_PATH", "dbPath", envString],
  ["ASPEX_NEEDS_ME_CAP", "needsMeCap", envPositiveInt],
  ["ASPEX_POLL_INTERVAL_MS", "pollIntervalMs", envPositiveInt],
  ["ASPEX_MOCK", "mock", envBoolean],
  ["ASPEX_GITHUB_TOKEN", "github.token", envString],
  ["ASPEX_GITHUB_ALLOWLIST", "github.allowlist", envCsv, "github"],
  ["ASPEX_NTFY_TOPIC", "ntfy.topic", envString],
  ["ASPEX_NTFY_SERVER", "ntfy.server", envString, "ntfy"],
  ["ASPEX_NTFY_MIN_SEVERITY", "ntfy.minSeverity", envSeverity, "ntfy"],
  ["ASPEX_VOICE_ENABLED", "voice.enabled", envBoolean],
  ["ASPEX_VOICE_STT", "voice.stt.endpoints", envCsv],
  ["ASPEX_VOICE_TTS", "voice.tts.endpoint", envString],
  ["ASPEX_VOICE_CONFIDENCE", "voice.confidenceThreshold", envNumber],
  ["ASPEX_VOICE_MOCK", "voice.mock", envBoolean],
  ["ASPEX_VOICE_PTT_KEY", "voice.pttKey", envString],
  ["ASPEX_INTENT_ENABLED", "intent.enabled", envBoolean],
  ["ASPEX_INTENT_ENDPOINTS", "intent.endpoints", envCsv],
  ["ASPEX_INTENT_MODEL", "intent.model", envString],
  ["ASPEX_INTENT_MOCK", "intent.mock", envBoolean],
  ["ASPEX_CODEX_ENABLED", "adapters.codex.enabled", envBoolean],
  ["ASPEX_OPENCODE_ENABLED", "adapters.opencode.enabled", envBoolean],
  ["ASPEX_OPENCODE_SERVER_URL", "adapters.opencode.serverUrl", envString],
  ["ASPEX_OPENCODE_DIRECTORY", "adapters.opencode.directory", envString],
  ["ASPEX_CURSOR_ENABLED", "adapters.cursor.enabled", envBoolean],
  ["ASPEX_CURSOR_SECRET", "adapters.cursor.secret", envString],
  ["ASPEX_GILES_ENABLED", "orchestrators.giles.enabled", envBoolean],
  ["ASPEX_GILES_HOME", "orchestrators.giles.home", envString],
  ["ASPEX_GILES_POLL_INTERVAL_MS", "orchestrators.giles.pollIntervalMs", envPositiveInt],
  ["ASPEX_LIVENESS_POLL_GRACE_MS", "liveness.pollGraceMs", envPositiveInt],
  ["ASPEX_LIVENESS_HEARTBEAT_GRACE_MS", "liveness.heartbeatGraceMs", envPositiveInt],
  ["ASPEX_LIVENESS_QUIET_AFTER_MS", "liveness.quietAfterMs", envPositiveInt],
  ["ASPEX_LIVENESS_STALE_AFTER_MS", "liveness.staleAfterMs", envPositiveInt],
  ["ASPEX_LIVENESS_LOST_AFTER_MS", "liveness.lostAfterMs", envPositiveInt],
];

const ENV_BY_PATH = new Map(ENV_OVERRIDES.map(([name, path]) => [path, name]));

function applyEnvOverrides(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): void {
  for (const [name, path, schema, requiresSection] of ENV_OVERRIDES) {
    const raw = env[name];

    if (raw === undefined) {
      continue;
    }

    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      throw new Error(
        `${name} ${parsed.error.issues[0]?.message ?? "is invalid"}`,
      );
    }

    if (
      requiresSection !== undefined &&
      config[requiresSection] === undefined
    ) {
      continue;
    }

    setConfigPath(config, path, parsed.data);
  }
}

function setConfigPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  const last = keys.pop();

  if (last === undefined) {
    return;
  }

  let node = target;

  for (const key of keys) {
    const next = node[key];

    if (next === undefined) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else if (isRecord(next)) {
      node = next;
    } else {
      // A malformed section in the file; leave it for the schema to report.
      return;
    }
  }

  node[last] = value;
}

// A global mock: true turns the voice and intent services into mocks unless
// the section pins its own mock value.
function inheritGlobalMock(config: Record<string, unknown>): void {
  if (config.mock !== true) {
    return;
  }

  for (const section of ["voice", "intent"]) {
    const current = config[section];

    if (current === undefined) {
      config[section] = { mock: true };
    } else if (isRecord(current) && current.mock === undefined) {
      current.mock = true;
    }
  }
}

function configParseError(error: z.ZodError): Error {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".");
    const envName = ENV_BY_PATH.get(path);
    const source = envName === undefined ? "" : ` (env ${envName})`;
    return path === ""
      ? `${issue.message}${source}`
      : `${path} ${issue.message}${source}`;
  });
  return new Error(`Invalid Aspex config: ${lines.join("; ")}`);
}

// --- loading ---------------------------------------------------------------

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
  const config = await readConfigFile(path, configPath !== undefined);

  applyEnvOverrides(config, env);

  if (mock !== undefined) {
    config.mock = mock;
  }

  inheritGlobalMock(config);

  const parsed = aspexConfigSchema.safeParse(config);

  if (!parsed.success) {
    throw configParseError(parsed.error);
  }

  return parsed.data;
}

export function resolvedLivenessConfig(cfg: AspexConfig): LivenessConfig {
  return {
    ...DEFAULT_CONFIG.liveness,
    ...cfg.liveness,
  };
}

// The concrete filesystem path loadConfig reads, so a caller can persist a
// generated token back into the same file.
export function resolveConfigPath(configPath?: string): string {
  return expandHome(configPath ?? DEFAULT_CONFIG_PATH);
}

// The address local CLI clients (hook relay) dial to
// reach the running Hub. A wildcard bind still serves loopback; a specific
// bind serves only that address.
export function hubClientHost(cfg: Pick<AspexConfig, "hubBind">): string {
  const bind = cfg.hubBind;

  if (bind === "0.0.0.0" || bind === "::" || bind === "*") {
    return "127.0.0.1";
  }

  return bind.includes(":") ? `[${bind}]` : bind;
}

// Merge a generated auth token into the config file, preserving any other keys.
export async function persistHubToken(
  path: string,
  token: string,
  {
    defaultConfigPath = DEFAULT_CONFIG_PATH,
  }: { defaultConfigPath?: string } = {},
): Promise<void> {
  const existing = await readConfigFile(path, false);
  const next = {
    ...existing,
    auth: { ...(isRecord(existing.auth) ? existing.auth : {}), token },
  };

  const directory = dirname(path);
  const ownsDirectory =
    resolve(path) === resolve(expandHome(defaultConfigPath));
  await mkdir(directory, {
    recursive: true,
    ...(ownsDirectory ? { mode: 0o700 } : {}),
  });
  if (ownsDirectory) {
    await chmod(directory, 0o700);
  }
  await writeSecureConfigFile(path, `${JSON.stringify(next, null, 2)}\n`);
  await chmod(path, 0o600);
}

async function writeSecureConfigFile(
  path: string,
  content: string,
): Promise<void> {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function readConfigFile(
  path: string,
  required: boolean,
): Promise<Record<string, unknown>> {
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
