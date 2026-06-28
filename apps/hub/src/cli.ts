#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  installClaudeCodeHooks,
  runHookRelay,
  uninstallClaudeCodeHooks,
} from "@aspex/adapter-claude-code";
import { VERSION, buildHub } from "./boot";
import { type VoiceConfig, loadConfig } from "./config";

type Command = "hub" | "up" | "hooks" | "hook-relay" | "voice";

const HELP = `aspex ${VERSION}

Usage:
  aspex hub [--config <path>] [--mock]
  aspex up [--config <path>] [--mock]
  aspex voice check [--config <path>]
  aspex hooks install|uninstall
  aspex hook-relay --event <Name>

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

  if (command === "voice") {
    await runVoiceCommand(parsed.positionals.slice(1), {
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

interface ProbeResult {
  endpoint: string;
  ok: boolean;
  detail?: string;
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

async function runRelayCommand(options: {
  configPath?: string;
  event?: string;
}): Promise<void> {
  try {
    if (options.event === undefined || options.event.trim() === "") {
      return;
    }

    const cfg = await loadConfig({ configPath: options.configPath });

    await runHookRelay({ event: options.event, hubPort: cfg.hubPort });
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
