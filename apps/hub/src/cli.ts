#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  installClaudeCodeHooks,
  runHookRelay,
  uninstallClaudeCodeHooks,
} from "@aspex/adapter-claude-code";
import { installCodexNotify, uninstallCodexNotify } from "@aspex/adapter-codex";
import type { Preview } from "@aspex/schema";
import { VERSION, buildHub } from "./boot";
import {
  type IntentConfig,
  type PreviewConfig,
  type VoiceConfig,
  loadConfig,
} from "./config";
import type { PreviewEngine } from "./preview/engine";
import { createDockerEngine } from "./preview/engineDocker";
import { createMockEngine } from "./preview/engineMock";
import { loadPreviewRegistry } from "./preview/registry";

type Command =
  | "hub"
  | "up"
  | "hooks"
  | "hook-relay"
  | "codex"
  | "voice"
  | "intent"
  | "preview";

const HELP = `aspex ${VERSION}

Usage:
  aspex hub [--config <path>] [--mock]
  aspex up [--config <path>] [--mock]
  aspex voice check [--config <path>]
  aspex intent check [--config <path>]
  aspex preview check [--config <path>] [--engine docker|mock]
  aspex preview list [--config <path>]
  aspex hooks install|uninstall
  aspex codex install|uninstall
  aspex hook-relay --event <Name>
  aspex hook-relay --source codex <notify-json>

Options:
  --config <path>  Load a JSON config file
  --engine <kind>  Override preview engine for preview check
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
      engine: { type: "string" },
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

  if (command === "preview") {
    await runPreviewCommand(parsed.positionals.slice(1), {
      configPath:
        typeof parsed.values.config === "string"
          ? parsed.values.config
          : undefined,
      engine:
        typeof parsed.values.engine === "string"
          ? parsed.values.engine
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

export async function runPreviewCommand(
  args: string[],
  options: { configPath?: string; engine?: string } = {},
): Promise<void> {
  const action = args[0];

  if (action === "check") {
    await runPreviewCheck(options);
    return;
  }

  if (action === "list") {
    await runPreviewList(options);
    return;
  }

  console.error("Usage: aspex preview check|list [--config <path>]");
  process.exitCode = 1;
}

async function runPreviewCheck(options: {
  configPath?: string;
  engine?: string;
}): Promise<void> {
  const cfg = await loadConfig({ configPath: options.configPath });
  const previews = cfg.previews;

  if (previews?.enabled !== true) {
    console.log("previews disabled");
    return;
  }

  const engineKind =
    options.engine === undefined
      ? previews.engine
      : parseCliPreviewEngine(options.engine);
  const effectivePreviews = { ...previews, engine: engineKind };
  const engine = createCliPreviewEngine(engineKind);
  const engineAvailable = await engine.available();
  const { registry, errors } = loadPreviewRegistry(effectivePreviews.specs);

  console.log("Preview Deck: enabled");
  console.log(
    `Engine: ${engineKind} (${engineAvailable ? "available" : "unavailable"})`,
  );

  for (const error of errors) {
    console.log(
      `SKIP spec[${error.index}]${
        error.specId === undefined ? "" : ` ${error.specId}`
      }: ${error.message}`,
    );
  }

  const specs = registry.list();
  if (specs.length === 0) {
    console.log("No valid Preview specs configured.");
    return;
  }

  for (const spec of specs) {
    const reason = previewBootabilityReason({
      trust: spec.trust,
      engineAvailable,
      engineKind: effectivePreviews.engine,
    });
    console.log(`${spec.id}\t${spec.trust}\t${reason}`);
  }
}

async function runPreviewList(options: { configPath?: string }): Promise<void> {
  const cfg = await loadConfig({ configPath: options.configPath });
  const response = await fetch(`http://127.0.0.1:${cfg.hubPort}/previews`);

  if (response.status === 404) {
    console.log("Preview Deck disabled or unavailable on the running Hub.");
    return;
  }

  if (!response.ok) {
    console.error(
      `Preview list failed: ${response.status} ${response.statusText}`,
    );
    process.exitCode = 1;
    return;
  }

  const previews = (await response.json()) as Preview[];
  if (previews.length === 0) {
    console.log("No live previews.");
    return;
  }

  for (const preview of previews) {
    console.log(
      `${preview.previewId}\t${preview.specId}\t${preview.state}\t${
        preview.url ?? ""
      }`,
    );
  }
}

function previewBootabilityReason(args: {
  trust: "trusted" | "untrusted";
  engineAvailable: boolean;
  engineKind: PreviewConfig["engine"];
}): string {
  if (args.trust === "untrusted") {
    return "not bootable (pixels lane n/a)";
  }

  if (!args.engineAvailable) {
    return `not bootable (${args.engineKind} engine unavailable)`;
  }

  return "bootable";
}

function createCliPreviewEngine(kind: PreviewConfig["engine"]): PreviewEngine {
  return kind === "mock" ? createMockEngine() : createDockerEngine();
}

function parseCliPreviewEngine(raw: string): PreviewConfig["engine"] {
  if (raw === "docker" || raw === "mock") {
    return raw;
  }

  throw new Error("--engine must be docker or mock");
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
      hubPort: cfg.hubPort,
      source,
      jsonArg: options.jsonArg,
    });
  } catch (_error) {
    return;
  }
}

async function runHub(options: {
  configPath?: string;
  mock?: boolean;
}): Promise<void> {
  const cfg = await loadConfig(options);
  const hub = buildHub(cfg);
  let stopping = false;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    await hub.start();
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: cfg.hubPort,
      fetch: hub.app.fetch,
    });
  } catch (error) {
    server?.stop(true);
    await hub.stop();
    throw error;
  }

  console.log(`Aspex Hub on http://127.0.0.1:${server.port}`);

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
