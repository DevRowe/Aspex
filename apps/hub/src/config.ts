import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { PreviewSpec, Severity } from "@aspex/schema";
import type { LivenessConfig } from "./engine/liveness";

export interface AspexConfig {
  hubPort: number;
  dbPath: string;
  needsMeCap: number;
  pollIntervalMs: number;
  github?: { token: string; allowlist?: string[] };
  ntfy?: { server?: string; topic: string; minSeverity?: "medium" | "high" };
  liveness?: Partial<LivenessConfig>;
  voice?: VoiceConfig;
  intent?: IntentConfig;
  previews?: PreviewConfig;
  adapters?: AdaptersConfig;
  mock?: boolean;
}

export interface VoiceConfig {
  enabled: boolean;
  stt: { endpoints: string[]; timeoutMs: number };
  tts: { endpoint?: string };
  confidenceThreshold: number;
  confirmTtlMs: number;
  pttKey: string;
  mock?: boolean;
}

export interface IntentConfig {
  enabled: boolean;
  endpoints: string[];
  model: string;
  timeoutMs: number;
  elevateConfirm: boolean;
  mock?: boolean;
}

export interface PreviewConfig {
  enabled: boolean;
  engine: "docker" | "mock";
  maxConcurrent: number;
  limits: {
    cpus: string;
    memory: string;
    idleTtlSec: number;
  };
  specs: PreviewSpec[];
}

export interface AdaptersConfig {
  codex?: { enabled: boolean };
  opencode?: { enabled: boolean; serverUrl: string; directory?: string };
  cursor?: { enabled: boolean; secret?: string };
}

type ConfigFile = Partial<
  Omit<
    AspexConfig,
    | "github"
    | "ntfy"
    | "liveness"
    | "voice"
    | "intent"
    | "previews"
    | "adapters"
  >
> & {
  github?: Partial<AspexConfig["github"]>;
  ntfy?: Partial<AspexConfig["ntfy"]>;
  liveness?: Partial<LivenessConfig>;
  voice?: Partial<Omit<VoiceConfig, "stt" | "tts">> & {
    stt?: Partial<VoiceConfig["stt"]>;
    tts?: Partial<VoiceConfig["tts"]>;
  };
  intent?: Partial<IntentConfig>;
  previews?: Partial<Omit<PreviewConfig, "limits">> & {
    limits?: Partial<PreviewConfig["limits"]>;
  };
  adapters?: {
    codex?: Partial<NonNullable<AdaptersConfig["codex"]>>;
    opencode?: Partial<NonNullable<AdaptersConfig["opencode"]>>;
    cursor?: Partial<NonNullable<AdaptersConfig["cursor"]>>;
  };
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: false,
  stt: {
    endpoints: ["http://127.0.0.1:8901/transcribe"],
    timeoutMs: 5000,
  },
  tts: {},
  confidenceThreshold: 0.6,
  confirmTtlMs: 8000,
  pttKey: "Space",
};

const DEFAULT_INTENT_CONFIG: IntentConfig = {
  enabled: false,
  endpoints: ["http://127.0.0.1:11434"],
  model: "llama3.1",
  timeoutMs: 8000,
  elevateConfirm: true,
};

const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  enabled: false,
  engine: "docker",
  maxConcurrent: 3,
  limits: { cpus: "1", memory: "512m", idleTtlSec: 600 },
  specs: [],
};

const DEFAULT_ADAPTERS_CONFIG: AdaptersConfig = {
  codex: { enabled: false },
  opencode: { enabled: false, serverUrl: "http://127.0.0.1:4096" },
  cursor: { enabled: false },
};

export const DEFAULT_CONFIG: AspexConfig = {
  hubPort: 4317,
  dbPath: "~/.aspex/aspex.sqlite",
  needsMeCap: 7,
  pollIntervalMs: 60_000,
  voice: DEFAULT_VOICE_CONFIG,
  intent: DEFAULT_INTENT_CONFIG,
  previews: DEFAULT_PREVIEW_CONFIG,
  adapters: DEFAULT_ADAPTERS_CONFIG,
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
    voice: mergeVoiceConfig(base.voice, override.voice),
    intent: mergeIntentConfig(base.intent, override.intent),
    previews: mergePreviewConfig(base.previews, override.previews),
    adapters: mergeAdaptersConfig(base.adapters, override.adapters),
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
  const voiceEnabled =
    env.ASPEX_VOICE_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_VOICE_ENABLED,
          cfg.voice?.enabled,
          "ASPEX_VOICE_ENABLED",
        )
      : undefined;
  const voiceStt = parseCsv(env.ASPEX_VOICE_STT);
  const voiceTts =
    env.ASPEX_VOICE_TTS !== undefined
      ? optionalNonEmptyEnv(env.ASPEX_VOICE_TTS, "ASPEX_VOICE_TTS")
      : undefined;
  const voiceConfidence =
    env.ASPEX_VOICE_CONFIDENCE !== undefined
      ? parseNumber(
          env.ASPEX_VOICE_CONFIDENCE,
          cfg.voice?.confidenceThreshold,
          "ASPEX_VOICE_CONFIDENCE",
        )
      : undefined;
  const voiceMock =
    env.ASPEX_VOICE_MOCK !== undefined
      ? parseBoolean(env.ASPEX_VOICE_MOCK, cfg.voice?.mock, "ASPEX_VOICE_MOCK")
      : undefined;
  const voicePttKey =
    env.ASPEX_VOICE_PTT_KEY !== undefined
      ? optionalNonEmptyEnv(env.ASPEX_VOICE_PTT_KEY, "ASPEX_VOICE_PTT_KEY")
      : undefined;
  const intentEnabled =
    env.ASPEX_INTENT_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_INTENT_ENABLED,
          cfg.intent?.enabled,
          "ASPEX_INTENT_ENABLED",
        )
      : undefined;
  const intentEndpoints = parseCsv(env.ASPEX_INTENT_ENDPOINTS);
  const intentModel =
    env.ASPEX_INTENT_MODEL !== undefined
      ? optionalNonEmptyEnv(env.ASPEX_INTENT_MODEL, "ASPEX_INTENT_MODEL")
      : undefined;
  const intentMock =
    env.ASPEX_INTENT_MOCK !== undefined
      ? parseBoolean(
          env.ASPEX_INTENT_MOCK,
          cfg.intent?.mock,
          "ASPEX_INTENT_MOCK",
        )
      : undefined;
  const previewsEnabled =
    env.ASPEX_PREVIEWS_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_PREVIEWS_ENABLED,
          cfg.previews?.enabled,
          "ASPEX_PREVIEWS_ENABLED",
        )
      : undefined;
  const previewsEngine =
    env.ASPEX_PREVIEWS_ENGINE !== undefined
      ? parsePreviewEngine(env.ASPEX_PREVIEWS_ENGINE)
      : undefined;
  const previewsMaxConcurrent =
    env.ASPEX_PREVIEWS_MAX_CONCURRENT !== undefined
      ? parseInteger(
          env.ASPEX_PREVIEWS_MAX_CONCURRENT,
          cfg.previews?.maxConcurrent,
          "ASPEX_PREVIEWS_MAX_CONCURRENT",
        )
      : undefined;
  const previewsIdleTtlSec =
    env.ASPEX_PREVIEWS_IDLE_TTL_SEC !== undefined
      ? parseInteger(
          env.ASPEX_PREVIEWS_IDLE_TTL_SEC,
          cfg.previews?.limits.idleTtlSec,
          "ASPEX_PREVIEWS_IDLE_TTL_SEC",
        )
      : undefined;
  const codexEnabled =
    env.ASPEX_CODEX_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_CODEX_ENABLED,
          cfg.adapters?.codex?.enabled,
          "ASPEX_CODEX_ENABLED",
        )
      : undefined;
  const opencodeEnabled =
    env.ASPEX_OPENCODE_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_OPENCODE_ENABLED,
          cfg.adapters?.opencode?.enabled,
          "ASPEX_OPENCODE_ENABLED",
        )
      : undefined;
  const opencodeServerUrl =
    env.ASPEX_OPENCODE_SERVER_URL !== undefined
      ? optionalNonEmptyEnv(
          env.ASPEX_OPENCODE_SERVER_URL,
          "ASPEX_OPENCODE_SERVER_URL",
        )
      : undefined;
  const opencodeDirectory =
    env.ASPEX_OPENCODE_DIRECTORY !== undefined
      ? optionalNonEmptyEnv(
          env.ASPEX_OPENCODE_DIRECTORY,
          "ASPEX_OPENCODE_DIRECTORY",
        )
      : undefined;
  const cursorEnabled =
    env.ASPEX_CURSOR_ENABLED !== undefined
      ? parseBoolean(
          env.ASPEX_CURSOR_ENABLED,
          cfg.adapters?.cursor?.enabled,
          "ASPEX_CURSOR_ENABLED",
        )
      : undefined;
  const cursorSecret =
    env.ASPEX_CURSOR_SECRET !== undefined
      ? optionalNonEmptyEnv(env.ASPEX_CURSOR_SECRET, "ASPEX_CURSOR_SECRET")
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
  const hasVoiceEnv =
    voiceEnabled !== undefined ||
    voiceStt !== undefined ||
    voiceTts !== undefined ||
    voiceConfidence !== undefined ||
    voiceMock !== undefined ||
    voicePttKey !== undefined;
  const voiceBase = cfg.voice ?? DEFAULT_VOICE_CONFIG;
  const voice = hasVoiceEnv
    ? {
        ...voiceBase,
        ...(voiceEnabled !== undefined ? { enabled: voiceEnabled } : {}),
        ...(voiceConfidence !== undefined
          ? { confidenceThreshold: voiceConfidence }
          : {}),
        ...(voiceMock !== undefined ? { mock: voiceMock } : {}),
        ...(voicePttKey !== undefined ? { pttKey: voicePttKey } : {}),
        stt: {
          ...voiceBase.stt,
          ...(voiceStt !== undefined ? { endpoints: voiceStt } : {}),
        },
        tts: {
          ...voiceBase.tts,
          ...(voiceTts !== undefined ? { endpoint: voiceTts } : {}),
        },
      }
    : cfg.voice;
  const hasIntentEnv =
    intentEnabled !== undefined ||
    intentEndpoints !== undefined ||
    intentModel !== undefined ||
    intentMock !== undefined;
  const intentBase = cfg.intent ?? DEFAULT_INTENT_CONFIG;
  const intent = hasIntentEnv
    ? {
        ...intentBase,
        ...(intentEnabled !== undefined ? { enabled: intentEnabled } : {}),
        ...(intentEndpoints !== undefined
          ? { endpoints: intentEndpoints }
          : {}),
        ...(intentModel !== undefined ? { model: intentModel } : {}),
        ...(intentMock !== undefined ? { mock: intentMock } : {}),
      }
    : cfg.intent;
  const hasPreviewEnv =
    previewsEnabled !== undefined ||
    previewsEngine !== undefined ||
    previewsMaxConcurrent !== undefined ||
    previewsIdleTtlSec !== undefined;
  const previewBase = cfg.previews ?? DEFAULT_PREVIEW_CONFIG;
  const previews = hasPreviewEnv
    ? {
        ...previewBase,
        ...(previewsEnabled !== undefined ? { enabled: previewsEnabled } : {}),
        ...(previewsEngine !== undefined ? { engine: previewsEngine } : {}),
        ...(previewsMaxConcurrent !== undefined
          ? { maxConcurrent: previewsMaxConcurrent }
          : {}),
        limits: {
          ...previewBase.limits,
          ...(previewsIdleTtlSec !== undefined
            ? { idleTtlSec: previewsIdleTtlSec }
            : {}),
        },
      }
    : cfg.previews;
  const hasAdaptersEnv =
    codexEnabled !== undefined ||
    opencodeEnabled !== undefined ||
    opencodeServerUrl !== undefined ||
    opencodeDirectory !== undefined ||
    cursorEnabled !== undefined ||
    cursorSecret !== undefined;
  const adaptersBase = cfg.adapters ?? DEFAULT_ADAPTERS_CONFIG;
  const adapters: AspexConfig["adapters"] = hasAdaptersEnv
    ? {
        ...adaptersBase,
        codex: {
          ...(adaptersBase.codex ?? { enabled: false }),
          ...(codexEnabled !== undefined ? { enabled: codexEnabled } : {}),
        },
        opencode: {
          ...(adaptersBase.opencode ?? {
            enabled: false,
            serverUrl: "http://127.0.0.1:4096",
          }),
          ...(opencodeEnabled !== undefined
            ? { enabled: opencodeEnabled }
            : {}),
          ...(opencodeServerUrl !== undefined
            ? { serverUrl: opencodeServerUrl }
            : {}),
          ...(opencodeDirectory !== undefined
            ? { directory: opencodeDirectory }
            : {}),
        },
        cursor: {
          ...(adaptersBase.cursor ?? { enabled: false }),
          ...(cursorEnabled !== undefined ? { enabled: cursorEnabled } : {}),
          ...(cursorSecret !== undefined ? { secret: cursorSecret } : {}),
        },
      }
    : cfg.adapters;

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
    mock: parseBoolean(env.ASPEX_MOCK, cfg.mock, "ASPEX_MOCK"),
    voice,
    intent,
    previews,
    adapters,
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
    voice: normalizeVoiceConfig(cfg.voice, cfg.mock),
    intent: normalizeIntentConfig(cfg.intent, cfg.mock),
    previews: normalizePreviewConfig(cfg.previews),
    adapters: normalizeAdaptersConfig(cfg.adapters),
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

function normalizeAdaptersConfig(
  adapters: AdaptersConfig | undefined,
): AdaptersConfig {
  const normalized = mergeAdaptersConfig(DEFAULT_CONFIG.adapters, adapters);

  if (normalized === undefined) {
    throw new Error("adapters config defaults are missing");
  }

  const codex = normalized.codex ?? { enabled: false };
  const opencode = normalized.opencode ?? {
    enabled: false,
    serverUrl: "http://127.0.0.1:4096",
  };
  const cursor = normalized.cursor ?? { enabled: false };

  if (typeof codex.enabled !== "boolean") {
    throw new Error("adapters.codex.enabled must be a boolean");
  }

  if (typeof opencode.enabled !== "boolean") {
    throw new Error("adapters.opencode.enabled must be a boolean");
  }

  if (typeof cursor.enabled !== "boolean") {
    throw new Error("adapters.cursor.enabled must be a boolean");
  }

  if (
    opencode.directory !== undefined &&
    (typeof opencode.directory !== "string" || opencode.directory.trim() === "")
  ) {
    throw new Error(
      "adapters.opencode.directory must be a non-empty string when set",
    );
  }

  const serverUrl =
    typeof opencode.serverUrl === "string" && opencode.serverUrl.trim() !== ""
      ? opencode.serverUrl.trim()
      : undefined;

  if (opencode.enabled && serverUrl === undefined) {
    throw new Error(
      "adapters.opencode.serverUrl must be a non-empty valid URL when opencode is enabled",
    );
  }

  const normalizedServerUrl =
    opencode.enabled && serverUrl !== undefined
      ? adapterBaseUrl(
          serverUrl,
          "adapters.opencode.serverUrl must be a non-empty valid URL when opencode is enabled",
        )
      : (opencode.serverUrl ?? "");

  if (
    cursor.enabled &&
    (typeof cursor.secret !== "string" || cursor.secret.trim() === "")
  ) {
    throw new Error(
      "adapters.cursor.secret must be a non-empty string when cursor is enabled",
    );
  }

  return {
    codex: { enabled: codex.enabled },
    opencode: {
      enabled: opencode.enabled,
      serverUrl: normalizedServerUrl,
      ...(opencode.directory === undefined
        ? {}
        : { directory: opencode.directory.trim() }),
    },
    cursor: {
      enabled: cursor.enabled,
      ...(cursor.secret === undefined ? {} : { secret: cursor.secret.trim() }),
    },
  };
}

function normalizeIntentConfig(
  intent: IntentConfig | undefined,
  globalMock: boolean | undefined,
): IntentConfig {
  const normalized = mergeIntentConfig(DEFAULT_CONFIG.intent, intent);

  if (normalized === undefined) {
    throw new Error("intent config defaults are missing");
  }

  const withMock = {
    ...normalized,
    mock: normalized.mock ?? (globalMock === true ? true : undefined),
  };

  if (typeof withMock.enabled !== "boolean") {
    throw new Error("intent.enabled must be a boolean");
  }

  if (withMock.mock !== undefined && typeof withMock.mock !== "boolean") {
    throw new Error("intent.mock must be a boolean");
  }

  if (typeof withMock.elevateConfirm !== "boolean") {
    throw new Error("intent.elevateConfirm must be a boolean");
  }

  if (!Number.isInteger(withMock.timeoutMs) || withMock.timeoutMs <= 0) {
    throw new Error("intent.timeoutMs must be a positive integer");
  }

  if (typeof withMock.model !== "string" || withMock.model.trim() === "") {
    throw new Error("intent.model must be a non-empty string");
  }

  if (!Array.isArray(withMock.endpoints)) {
    throw new Error("intent.endpoints must be an array");
  }

  if (
    withMock.endpoints.some(
      (endpoint) => typeof endpoint !== "string" || endpoint.trim() === "",
    )
  ) {
    throw new Error("intent.endpoints must contain non-empty strings");
  }

  const endpoints = withMock.endpoints.map((endpoint) =>
    intentBaseUrl(endpoint, "intent.endpoints"),
  );

  if (withMock.enabled && withMock.mock !== true && endpoints.length === 0) {
    throw new Error(
      "intent.endpoints must contain at least one endpoint when intent is enabled",
    );
  }

  return {
    ...withMock,
    endpoints,
    model: withMock.model.trim(),
  };
}

function normalizePreviewConfig(
  previews: PreviewConfig | undefined,
): PreviewConfig {
  const normalized = mergePreviewConfig(DEFAULT_CONFIG.previews, previews);

  if (normalized === undefined) {
    throw new Error("previews config defaults are missing");
  }

  if (normalized.engine !== "docker" && normalized.engine !== "mock") {
    throw new Error("previews.engine must be docker or mock");
  }

  if (typeof normalized.enabled !== "boolean") {
    throw new Error("previews.enabled must be a boolean");
  }

  if (
    !Number.isInteger(normalized.maxConcurrent) ||
    normalized.maxConcurrent <= 0
  ) {
    throw new Error("previews.maxConcurrent must be a positive integer");
  }

  if (
    typeof normalized.limits.cpus !== "string" ||
    normalized.limits.cpus.trim() === ""
  ) {
    throw new Error("previews.limits.cpus must be a non-empty string");
  }

  if (
    typeof normalized.limits.memory !== "string" ||
    normalized.limits.memory.trim() === ""
  ) {
    throw new Error("previews.limits.memory must be a non-empty string");
  }

  if (
    !Number.isInteger(normalized.limits.idleTtlSec) ||
    normalized.limits.idleTtlSec <= 0
  ) {
    throw new Error("previews.limits.idleTtlSec must be a positive integer");
  }

  if (!Array.isArray(normalized.specs)) {
    throw new Error("previews.specs must be an array");
  }

  return {
    ...normalized,
    limits: { ...normalized.limits },
    specs: [...normalized.specs],
  };
}

function normalizeVoiceConfig(
  voice: VoiceConfig | undefined,
  globalMock: boolean | undefined,
): VoiceConfig {
  const normalized = mergeVoiceConfig(DEFAULT_CONFIG.voice, voice);

  if (normalized === undefined) {
    throw new Error("voice config defaults are missing");
  }

  const withMock = {
    ...normalized,
    mock: normalized.mock ?? (globalMock === true ? true : undefined),
  };

  if (
    typeof withMock.confidenceThreshold !== "number" ||
    !Number.isFinite(withMock.confidenceThreshold) ||
    withMock.confidenceThreshold < 0 ||
    withMock.confidenceThreshold > 1
  ) {
    throw new Error("voice.confidenceThreshold must be between 0 and 1");
  }

  if (
    !Number.isInteger(withMock.stt.timeoutMs) ||
    withMock.stt.timeoutMs <= 0
  ) {
    throw new Error("voice.stt.timeoutMs must be a positive integer");
  }

  if (!Number.isInteger(withMock.confirmTtlMs) || withMock.confirmTtlMs <= 0) {
    throw new Error("voice.confirmTtlMs must be a positive integer");
  }

  if (typeof withMock.pttKey !== "string" || withMock.pttKey.trim() === "") {
    throw new Error("voice.pttKey must be a non-empty string");
  }

  if (
    withMock.stt.endpoints.some(
      (endpoint) => typeof endpoint !== "string" || endpoint.trim() === "",
    )
  ) {
    throw new Error("voice.stt.endpoints must contain non-empty strings");
  }

  if (
    withMock.tts.endpoint !== undefined &&
    (typeof withMock.tts.endpoint !== "string" ||
      withMock.tts.endpoint.trim() === "")
  ) {
    throw new Error("voice.tts.endpoint must be a non-empty string when set");
  }

  const normalizedEndpoints = withMock.stt.endpoints.map((endpoint) =>
    voiceContractUrl(endpoint, "/transcribe", "voice.stt.endpoints"),
  );
  const normalizedTtsEndpoint =
    withMock.tts.endpoint === undefined
      ? undefined
      : voiceContractUrl(withMock.tts.endpoint, "/speak", "voice.tts.endpoint");
  const normalizedVoice: VoiceConfig = {
    ...withMock,
    stt: { ...withMock.stt, endpoints: normalizedEndpoints },
    tts:
      normalizedTtsEndpoint === undefined
        ? {}
        : { ...withMock.tts, endpoint: normalizedTtsEndpoint },
  };

  if (
    normalizedVoice.enabled &&
    normalizedVoice.mock !== true &&
    normalizedVoice.stt.endpoints.length === 0
  ) {
    throw new Error(
      "voice.stt.endpoints must contain at least one endpoint when voice is enabled",
    );
  }

  return normalizedVoice;
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
  name: string,
): boolean | undefined {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`${name} must be a boolean (true, false, 1, or 0)`);
}

function parseNumber(
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

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function parseNtfySeverity(raw: string): Extract<Severity, "medium" | "high"> {
  if (raw === "medium" || raw === "high") {
    return raw;
  }

  throw new Error("ASPEX_NTFY_MIN_SEVERITY must be medium or high");
}

function parsePreviewEngine(raw: string): PreviewConfig["engine"] {
  if (raw === "docker" || raw === "mock") {
    return raw;
  }

  throw new Error("ASPEX_PREVIEWS_ENGINE must be docker or mock");
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

function mergeVoiceConfig(
  base: VoiceConfig | undefined,
  override: ConfigFile["voice"] | undefined,
): VoiceConfig | undefined {
  if (override === undefined) {
    return base;
  }

  return {
    ...(base ?? DEFAULT_VOICE_CONFIG),
    ...override,
    stt: {
      ...(base?.stt ?? DEFAULT_VOICE_CONFIG.stt),
      ...override.stt,
    },
    tts: {
      ...(base?.tts ?? DEFAULT_VOICE_CONFIG.tts),
      ...override.tts,
    },
  } as VoiceConfig;
}

function mergeIntentConfig(
  base: IntentConfig | undefined,
  override: ConfigFile["intent"] | undefined,
): IntentConfig | undefined {
  if (override === undefined) {
    return base;
  }

  return {
    ...(base ?? DEFAULT_INTENT_CONFIG),
    ...override,
    endpoints:
      override.endpoints ?? base?.endpoints ?? DEFAULT_INTENT_CONFIG.endpoints,
  } as IntentConfig;
}

function mergePreviewConfig(
  base: PreviewConfig | undefined,
  override: ConfigFile["previews"] | undefined,
): PreviewConfig | undefined {
  if (override === undefined) {
    return base;
  }

  return {
    ...(base ?? DEFAULT_PREVIEW_CONFIG),
    ...override,
    limits: {
      ...(base?.limits ?? DEFAULT_PREVIEW_CONFIG.limits),
      ...override.limits,
    },
    specs: override.specs ?? base?.specs ?? DEFAULT_PREVIEW_CONFIG.specs,
  } as PreviewConfig;
}

function mergeAdaptersConfig(
  base: AdaptersConfig | undefined,
  override: ConfigFile["adapters"] | undefined,
): AdaptersConfig | undefined {
  if (override === undefined) {
    return base;
  }

  return {
    ...(base ?? DEFAULT_ADAPTERS_CONFIG),
    codex: {
      ...(base?.codex ?? { enabled: false }),
      ...override.codex,
    },
    opencode: {
      ...(base?.opencode ?? {
        enabled: false,
        serverUrl: "http://127.0.0.1:4096",
      }),
      ...override.opencode,
    },
    cursor: {
      ...(base?.cursor ?? { enabled: false }),
      ...override.cursor,
    },
  } as AdaptersConfig;
}

function adapterBaseUrl(endpoint: string, message: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (url.pathname === "") {
      url.pathname = "/";
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(message);
  }
}

function intentBaseUrl(endpoint: string, field: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (url.pathname === "") {
      url.pathname = "/";
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${field} must contain valid URLs`);
  }
}

function voiceContractUrl(
  endpoint: string,
  contractPath: "/transcribe" | "/speak",
  field: string,
): string {
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
    throw new Error(`${field} must contain valid URLs`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
