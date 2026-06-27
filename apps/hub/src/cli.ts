#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { VERSION, buildHub } from "./boot";
import { loadConfig } from "./config";

type Command = "hub" | "up" | "hooks" | "hook-relay";

const HELP = `aspex ${VERSION}

Usage:
  aspex hub [--config <path>] [--mock]
  aspex up [--config <path>] [--mock]
  aspex hooks ...
  aspex hook-relay ...

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

  if (command === "hooks" || command === "hook-relay") {
    console.log(`${command} is not yet installed; this arrives in card 16.`);
    return;
  }

  console.error(`Unknown command: ${String(command)}`);
  console.log(HELP);
  process.exitCode = 1;
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
