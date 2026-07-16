#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  installClaudeCodeHooks,
  runHookRelay,
  uninstallClaudeCodeHooks,
} from "@aspex/adapter-claude-code";
import { installCodexNotify, uninstallCodexNotify } from "@aspex/adapter-codex";
import { VERSION, buildHub } from "./boot";
import {
  type IntentConfig,
  type VoiceConfig,
  hubClientHost,
  loadConfig,
  persistHubToken,
  resolveConfigPath,
} from "./config";
import { generateHubToken } from "./http/auth";

type Command =
  | "hub"
  | "up"
  | "hooks"
  | "hook-relay"
  | "codex"
  | "voice"
  | "intent";

const HELP = `aspex ${VERSION}

Usage:
  aspex hub [--config <path>] [--mock]
  aspex up [--config <path>] [--mock]
  aspex voice check [--config <path>]
  aspex intent check [--config <path>]
  aspex hooks install|uninstall
  aspex codex install|uninstall
  aspex hook-relay --event <Name>
  aspex hook-relay --source codex <notify-json>

Options:
  --config <path>  Load a JSON config file
  --mock           Enable mock mode when available
  --help           Print help
  --version        Print version
`;

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      event: { type: "string" },
      help: { type: "boolean", short: "h" },
      mock: { type: "boolean" },
      source: { type: "string" },
      version: { type: "boolean", short: "v" },
    },
    strict: false,
  });

  if (parsed.values.version === true) {
    console.log(VERSION);
    return;
  }

  if (parsed.values.help === true || parsed.positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const command = parsed.positionals[0] as Command | undefined;

  if (command === "hub" || command === "up") {
    await runHub({
      configPath:
        typeof parsed.values.config === "string"
          ? parsed.values.config
          : undefined,
      mock:
        typeof parsed.values.mock === "boolean"
          ? parsed.values.mock
          : undefined,
    });
    return;
  }

  if (command === "hooks") {
    await runHooksCommand(parsed.positionals.slice(1));
    return;
  }

  if (command === "codex") {
    await runCodexCommand(parsed.positionals.slice(1));
    return;
  }

  if (command === "voice") {
    await runVoiceCommand(parsed.positionals.slice(1), {
      configPath:
        typeof parsed.values.config === "string"
          ? parsed.values.config
          : undefined,
    });
    return;
  }

  if (command === "intent") {
    await runIntentCommand(parsed.positionals.slice(1), {
      configPath:
        typeof parsed.values.config === "string"
          ? parsed.values.config
          : undefined,
    });
    return;
  }

  if (command === "hook-relay") {
    await runRelayCommand({
      configPath:
        typeof parsed.values.config === "string"
          ? parsed.values.config
          : undefined,
      event:
        typeof parsed.values.event === "string"
          ? parsed.values.event
          : undefined,
      source:
        typeof parsed.values.source === "string"
          ? parsed.values.source
          : undefined,
      jsonArg: parsed.positionals[1],
    });
    return;
  }

  console.error(`Unknown command: ${String(command)}`);
  console.log(HELP);
  process.exitCode = 1;
}

async function runVoiceCommand(
  args: string[],
  options: { configPath?: string },
): Promise<void> {
  if (args[0] !== "check") {
    console.error("Usage: aspex voice check [--config <path>]");
    process.exitCode = 1;
    return;
  }

  const cfg = await loadConfig({ configPath: options.configPath });
  const voice = cfg.voice;

  if (voice?.enabled !== true) {
    console.error("Voice is disabled in config.");
    process.exitCode = 1;
    return;
  }

  if (voice.mock === true) {
    console.log("Voice mock reachable: STT mock, TTS mock.");
    return;
  }

  const sttResults = await Promise.all(
    voice.stt.endpoints.map((endpoint) => probeSttEndpoint(endpoint, voice)),
  );
  const firstReachable = sttResults.find((result) => result.ok);

  for (const result of sttResults) {
    console.log(
      `${result.ok ? "OK" : "FAIL"} STT ${result.endpoint}${result.detail ? ` - ${result.detail}` : ""}`,
    );
  }

  if (voice.tts.endpoint !== undefined) {
    const tts = await probeTtsEndpoint(voice.tts.endpoint, voice.stt.timeoutMs);
    console.log(
      `${tts.ok ? "OK" : "FAIL"} TTS ${tts.endpoint}${tts.detail ? ` - ${tts.detail}` : ""}`,
    );
  } else {
    console.log("TTS disabled: text-only read-back.");
  }

  if (firstReachable === undefined) {
    console.error("No STT endpoint reachable.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Voice check passed. STT fallback starts at ${firstReachable.endpoint}.`,
  );
}

export async function runIntentCommand(
  args: string[],
  options: { configPath?: string; setExitCode?: (code: number) => void },
): Promise<void> {
  if (args[0] !== "check") {
    console.error("Usage: aspex intent check [--config <path>]");
    setIntentExitCode(options, 1);
    return;
  }

  const cfg = await loadConfig({ configPath: options.configPath });
  const intent = cfg.intent;

  if (intent?.enabled !== true) {
    console.error("Intent is disabled in config.");
    setIntentExitCode(options, 1);
    return;
  }

  if (intent.mock === true || cfg.mock === true) {
    console.log("Intent mock reachable: MockIntentService.");
    return;
  }

  const results = await Promise.all(
    intent.endpoints.map((endpoint) => probeIntentEndpoint(endpoint, intent)),
  );
  const firstReachable = results.find((result) => result.ok);

  for (const result of results) {
    console.log(
      `${result.ok ? "OK" : "FAIL"} Intent ${result.endpoint}${result.detail ? ` - ${result.detail}` : ""}`,
    );
  }

  if (firstReachable === undefined) {
    console.error("No intent endpoint reachable.");
    setIntentExitCode(options, 1);
    return;
  }

  console.log(
    `Intent check passed. Ollama fallback starts at ${firstReachable.endpoint}.`,
  );
}

function setIntentExitCode(
  options: { setExitCode?: (code: number) => void },
  code: number,
): void {
  if (options.setExitCode !== undefined) {
    options.setExitCode(code);
    return;
  }

  process.exitCode = code;
}

interface ProbeResult {
  endpoint: string;
  ok: boolean;
  detail?: string;
}

async function probeIntentEndpoint(
  endpoint: string,
  intent: IntentConfig,
): Promise<ProbeResult> {
  let tagsUrl: string;

  try {
    tagsUrl = ollamaTagsUrlFor(endpoint);
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }

  try {
    const response = await fetchWithTimeout(
      tagsUrl,
      { method: "GET" },
      intent.timeoutMs,
    );

    if (!response.ok) {
      return {
        endpoint,
        ok: false,
        detail: `/api/tags returned ${response.status}`,
      };
    }

    return { endpoint, ok: true, detail: "/api/tags reachable" };
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }
}

async function probeSttEndpoint(
  endpoint: string,
  voice: VoiceConfig,
): Promise<ProbeResult> {
  let healthUrl: string;
  let transcribeUrl: string;

  try {
    healthUrl = healthUrlFor(endpoint, "/transcribe");
    transcribeUrl = contractUrlFor(endpoint, "/transcribe");
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }

  try {
    await fetchWithTimeout(healthUrl, { method: "GET" }, voice.stt.timeoutMs);
  } catch {
    // /health is a convenience endpoint; the contract probe below is decisive.
  }

  try {
    const response = await fetchWithTimeout(
      transcribeUrl,
      {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: new Uint8Array([0]).buffer,
      },
      voice.stt.timeoutMs,
    );

    if (!response.ok) {
      return {
        endpoint,
        ok: false,
        detail: `/transcribe returned ${response.status}`,
      };
    }

    const body = await response.json();
    if (!isTranscriptLike(body)) {
      return { endpoint, ok: false, detail: "invalid transcript response" };
    }

    return { endpoint, ok: true, detail: "transcribe contract ok" };
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }
}

async function probeTtsEndpoint(
  endpoint: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  let speakUrl: string;

  try {
    speakUrl = contractUrlFor(endpoint, "/speak");
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }

  try {
    const response = await fetchWithTimeout(
      speakUrl,
      {
        method: "POST",
        headers: {
          accept: "audio/wav",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "Aspex voice check." }),
      },
      timeoutMs,
    );

    if (response.status === 200 || response.status === 204) {
      return {
        endpoint,
        ok: true,
        detail: `/speak returned ${response.status}`,
      };
    }

    return {
      endpoint,
      ok: false,
      detail: `/speak returned ${response.status}`,
    };
  } catch (error) {
    return { endpoint, ok: false, detail: errorMessage(error) };
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function healthUrlFor(
  endpoint: string,
  contractPath: "/transcribe" | "/speak",
): string {
  const url = new URL(endpoint);
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (trimmedPath.endsWith(contractPath)) {
    url.pathname = trimmedPath.slice(0, -contractPath.length) || "/";
  } else {
    url.pathname = trimmedPath === "" ? "/" : trimmedPath;
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/health`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function contractUrlFor(
  endpoint: string,
  contractPath: "/transcribe" | "/speak",
): string {
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
}

function ollamaTagsUrlFor(endpoint: string): string {
  const url = new URL(endpoint);
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  url.pathname =
    trimmedPath === "" || trimmedPath === "/"
      ? "/api/tags"
      : `${trimmedPath}/api/tags`;
  url.hash = "";
  url.search = "";
  return url.toString();
}

function isTranscriptLike(value: unknown): value is {
  text: string;
  confidence: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string" &&
    typeof (value as { confidence?: unknown }).confidence === "number"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}

async function runHooksCommand(args: string[]): Promise<void> {
  const action = args[0];

  if (action === "install") {
    const result = await installClaudeCodeHooks();
    console.log(`Installed Claude Code hooks in ${result.settingsPath}`);
    return;
  }

  if (action === "uninstall") {
    const result = await uninstallClaudeCodeHooks();
    console.log(`Uninstalled Claude Code hooks from ${result.settingsPath}`);
    return;
  }

  console.error("Usage: aspex hooks install|uninstall");
  process.exitCode = 1;
}

export async function runCodexCommand(args: string[]): Promise<void> {
  const action = args[0];

  if (action === "install") {
    const result = await installCodexNotify();
    console.log(`Installed Codex notify hook in ${result.configPath}`);
    return;
  }

  if (action === "uninstall") {
    const result = await uninstallCodexNotify();
    console.log(`Uninstalled Codex notify hook from ${result.configPath}`);
    return;
  }

  console.error("Usage: aspex codex install|uninstall");
  process.exitCode = 1;
}

async function runRelayCommand(options: {
  configPath?: string;
  event?: string;
  source?: string;
  jsonArg?: string;
}): Promise<void> {
  try {
    const source = options.source === "codex" ? "codex" : "claude-code";

    if (
      source === "claude-code" &&
      (options.event === undefined || options.event.trim() === "")
    ) {
      return;
    }

    const cfg = await loadConfig({ configPath: options.configPath });

    await runHookRelay({
      event: options.event,
      hubHost: hubClientHost(cfg),
      hubPort: cfg.hubPort,
      source,
      jsonArg: options.jsonArg,
      token: cfg.auth?.token,
    });
  } catch (_error) {
    return;
  }
}

// Guarantee the running Hub always has a bearer token (ADR-0023). A token
// supplied via config file or ASPEX_HUB_TOKEN is used as-is; otherwise one is
// generated on first boot and persisted to the config file. The env token is
// never written to disk.
async function ensureHubToken(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  configPath?: string,
): Promise<Awaited<ReturnType<typeof loadConfig>>> {
  if (cfg.auth?.token !== undefined) {
    return cfg;
  }

  const token = generateHubToken();
  const path = resolveConfigPath(configPath);
  await persistHubToken(path, token);
  console.log(`Aspex Hub generated a local API token in ${path}`);

  return { ...cfg, auth: { token } };
}

// Optional TLS for the tailnet exposure (docs/hub-api.md "TLS"): PEM
// cert/key, typically provisioned with `tailscale cert`.
function readTlsMaterial(
  tls: Awaited<ReturnType<typeof loadConfig>>["tls"],
): { cert: string; key: string } | undefined {
  if (tls === undefined) {
    return undefined;
  }

  return {
    cert: readPem(tls.certPath, "tls.certPath"),
    key: readPem(tls.keyPath, "tls.keyPath"),
  };
}

function readPem(path: string, field: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot read ${field} (${path}): ${reason}. Provision a cert with \`tailscale cert <machine>.<tailnet>.ts.net\` or point tls at an existing PEM pair.`,
    );
  }
}

async function runHub(options: {
  configPath?: string;
  mock?: boolean;
}): Promise<void> {
  const cfg = await ensureHubToken(
    await loadConfig(options),
    options.configPath,
  );
  const hub = buildHub(cfg);
  // Read TLS material before starting anything so a missing or unreadable
  // PEM fails fast with the file path, not at the first client handshake.
  const tls = readTlsMaterial(cfg.tls);
  let stopping = false;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    await hub.start();
    server = Bun.serve({
      hostname: cfg.hubBind,
      port: cfg.hubPort,
      ...(tls === undefined ? {} : { tls }),
      fetch: hub.app.fetch,
    });
  } catch (error) {
    server?.stop(true);
    await hub.stop();
    throw error;
  }

  const scheme = tls === undefined ? "http" : "https";
  console.log(`Aspex Hub on ${scheme}://${hubClientHost(cfg)}:${server.port}`);

  const stop = async () => {
    if (stopping) {
      return;
    }

    stopping = true;
    server?.stop(true);
    await hub.stop();
  };

  process.on("SIGINT", () => {
    stop()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });

  process.on("SIGTERM", () => {
    stop()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });

  await new Promise(() => {});
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
