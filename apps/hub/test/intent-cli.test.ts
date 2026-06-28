import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntentCommand } from "../src/cli";

describe("intent CLI", () => {
  test("intent check exits zero for mock intent", async () => {
    const configPath = await writeTempConfig({
      intent: { enabled: true, mock: true, endpoints: [] },
    });

    try {
      const exitCodes: number[] = [];
      const output = await captureConsole(() =>
        runIntentCommand(["check"], {
          configPath: configPath.path,
          setExitCode: (code) => exitCodes.push(code),
        }),
      );

      expect(output.log).toEqual(["Intent mock reachable: MockIntentService."]);
      expect(output.error).toEqual([]);
      expect(exitCodes).toEqual([]);
    } finally {
      await rm(configPath.dir, { recursive: true, force: true });
    }
  });

  test("intent check probes Ollama endpoints over HTTP and fails when none are reachable", async () => {
    const configPath = await writeTempConfig({
      intent: {
        enabled: true,
        endpoints: ["http://first:11434", "http://second:11434/base/"],
        model: "llama3.1",
        timeoutMs: 1000,
      },
    });
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response("unavailable", { status: 503 });
    };

    try {
      const exitCodes: number[] = [];
      const output = await captureConsole(() =>
        runIntentCommand(["check"], {
          configPath: configPath.path,
          setExitCode: (code) => exitCodes.push(code),
        }),
      );

      expect(calls).toEqual([
        "http://first:11434/api/tags",
        "http://second:11434/base/api/tags",
      ]);
      expect(output.log).toEqual([
        "FAIL Intent http://first:11434 - /api/tags returned 503",
        "FAIL Intent http://second:11434/base - /api/tags returned 503",
      ]);
      expect(output.error).toEqual(["No intent endpoint reachable."]);
      expect(exitCodes).toEqual([1]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(configPath.dir, { recursive: true, force: true });
    }
  });
});

async function writeTempConfig(config: unknown): Promise<{
  dir: string;
  path: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "aspex-intent-cli-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(config));

  return {
    dir,
    path,
  };
}

async function captureConsole(
  fn: () => Promise<void>,
): Promise<{ log: string[]; error: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const log: string[] = [];
  const error: string[] = [];

  console.log = (message?: unknown) => {
    log.push(String(message));
  };
  console.error = (message?: unknown) => {
    error.push(String(message));
  };

  try {
    await fn();
    return { log, error };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
