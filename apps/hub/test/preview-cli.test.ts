import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Preview } from "@aspex/schema";
import { runPreviewCommand } from "../src/cli";

describe("preview CLI", () => {
  test("preview check reports disabled previews", async () => {
    const configPath = await writeTempConfig({
      previews: { enabled: false },
    });

    try {
      const output = await captureConsole(() =>
        runPreviewCommand(["check"], { configPath: configPath.path }),
      );

      expect(output.log).toEqual(["previews disabled"]);
      expect(output.error).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      await rm(configPath.dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  test("preview check validates registry and reports mock bootability", async () => {
    const configPath = await writeTempConfig({
      previews: {
        enabled: true,
        engine: "docker",
        specs: [
          {
            id: "web",
            name: "Web",
            engine: "mock",
            image: "example/web:latest",
            port: 3000,
            trust: "trusted",
          },
          {
            id: "unsafe",
            name: "Unsafe",
            engine: "mock",
            image: "example/unsafe:latest",
            port: 3000,
            trust: "untrusted",
          },
          { id: "bad" },
        ],
      },
    });

    try {
      const output = await captureConsole(() =>
        runPreviewCommand(["check"], {
          configPath: configPath.path,
          engine: "mock",
        }),
      );

      expect(output.log).toContain("Preview Deck: enabled");
      expect(output.log).toContain("Engine: mock (available)");
      expect(output.log).toContain("SKIP spec[2]: Invalid PreviewSpec");
      expect(output.log).toContain("web\ttrusted\tbootable");
      expect(output.log).toContain(
        "unsafe\tuntrusted\tnot bootable (pixels lane n/a)",
      );
      expect(output.error).toEqual([]);
    } finally {
      await rm(configPath.dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  test("preview list reports disabled or unavailable routes without failing", async () => {
    const configPath = await writeTempConfig({ hubPort: 5317 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:5317/previews");
      return new Response("not found", { status: 404 });
    };

    try {
      const output = await captureConsole(() =>
        runPreviewCommand(["list"], { configPath: configPath.path }),
      );

      expect(output.log).toEqual([
        "Preview Deck disabled or unavailable on the running Hub.",
      ]);
      expect(output.error).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(configPath.dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  test("preview list prints live previews from the running Hub", async () => {
    const configPath = await writeTempConfig({ hubPort: 5318 });
    const originalFetch = globalThis.fetch;
    const preview: Preview = {
      previewId: "preview-1",
      specId: "web",
      state: "ready",
      trust: "trusted",
      url: "http://127.0.0.1:41999",
      startedAt: "2026-06-28T00:00:00.000Z",
    };
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:5318/previews");
      return Response.json([preview]);
    };

    try {
      const output = await captureConsole(() =>
        runPreviewCommand(["list"], { configPath: configPath.path }),
      );

      expect(output.log).toEqual([
        "preview-1\tweb\tready\thttp://127.0.0.1:41999",
      ]);
      expect(output.error).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(configPath.dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });
});

async function writeTempConfig(config: unknown): Promise<{
  dir: string;
  path: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "aspex-preview-cli-"));
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
