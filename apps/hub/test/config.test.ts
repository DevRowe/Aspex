import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  expandHome,
  loadConfig,
  resolvedLivenessConfig,
} from "../src/config";

describe("hub config", () => {
  test("loads defaults when the default config file is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-config-defaults-"));
    const cfg = await loadConfig({
      defaultConfigPath: join(dir, "missing-config.json"),
      env: {},
    });

    try {
      expect(cfg).toMatchObject({
        hubPort: 4317,
        needsMeCap: 7,
        pollIntervalMs: 60_000,
        liveness: DEFAULT_CONFIG.liveness,
      });
      expect(cfg.dbPath).toEndWith(join(".aspex", "aspex.sqlite"));
      expect(cfg.github).toBeUndefined();
      expect(cfg.ntfy).toBeUndefined();
      expect(cfg.voice).toEqual({
        enabled: false,
        stt: {
          endpoints: ["http://127.0.0.1:8901/transcribe"],
          timeoutMs: 5000,
        },
        tts: {},
        confidenceThreshold: 0.6,
        confirmTtlMs: 8000,
        pttKey: "Space",
      });
      expect(cfg.intent).toEqual({
        enabled: false,
        endpoints: ["http://127.0.0.1:11434"],
        model: "llama3.1",
        timeoutMs: 8000,
        elevateConfirm: true,
      });
      expect(cfg.previews).toEqual({
        enabled: false,
        engine: "docker",
        maxConcurrent: 3,
        limits: { cpus: "1", memory: "512m", idleTtlSec: 600 },
        specs: [],
      });
      expect(cfg.adapters).toEqual({
        codex: { enabled: false },
        opencode: {
          enabled: false,
          serverUrl: "http://127.0.0.1:4096",
        },
        cursor: { enabled: false },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("voice is disabled by default", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {},
    });

    expect(cfg.voice?.enabled).toBe(false);
  });

  test("intent is disabled by default", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {},
    });

    expect(cfg.intent?.enabled).toBe(false);
  });

  test("agent adapters are disabled by default", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {},
    });

    expect(cfg.adapters).toMatchObject({
      codex: { enabled: false },
      opencode: { enabled: false },
      cursor: { enabled: false },
    });
  });

  test("applies environment overrides after defaults", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_HUB_PORT: "5317",
        ASPEX_DB_PATH: ":memory:",
        ASPEX_NEEDS_ME_CAP: "3",
        ASPEX_POLL_INTERVAL_MS: "45000",
        ASPEX_GITHUB_TOKEN: "from-env",
        ASPEX_GITHUB_ALLOWLIST: "owner/repo, author:me",
        ASPEX_NTFY_TOPIC: "aspex",
        ASPEX_NTFY_MIN_SEVERITY: "high",
        ASPEX_MOCK: "true",
        ASPEX_LIVENESS_QUIET_AFTER_MS: "1000",
      },
    });

    expect(cfg).toMatchObject({
      hubPort: 5317,
      dbPath: ":memory:",
      needsMeCap: 3,
      pollIntervalMs: 45_000,
      github: {
        token: "from-env",
        allowlist: ["owner/repo", "author:me"],
      },
      ntfy: {
        topic: "aspex",
        minSeverity: "high",
      },
      mock: true,
    });
    expect(cfg.liveness?.quietAfterMs).toBe(1000);
    expect(cfg.voice?.mock).toBe(true);
    expect(cfg.intent?.mock).toBe(true);
  });

  test("applies preview environment overrides", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_PREVIEWS_ENABLED: "1",
        ASPEX_PREVIEWS_ENGINE: "mock",
        ASPEX_PREVIEWS_MAX_CONCURRENT: "5",
        ASPEX_PREVIEWS_IDLE_TTL_SEC: "30",
      },
    });

    expect(cfg.previews).toMatchObject({
      enabled: true,
      engine: "mock",
      maxConcurrent: 5,
      limits: { idleTtlSec: 30 },
    });
  });

  test("applies voice environment overrides", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_VOICE_ENABLED: "1",
        ASPEX_VOICE_STT:
          "http://127.0.0.1:8901/transcribe, http://gpu:8901/transcribe",
        ASPEX_VOICE_TTS: "http://127.0.0.1:8901/speak",
        ASPEX_VOICE_CONFIDENCE: "0.75",
        ASPEX_VOICE_MOCK: "true",
        ASPEX_VOICE_PTT_KEY: "KeyV",
      },
    });

    expect(cfg.voice).toMatchObject({
      enabled: true,
      stt: {
        endpoints: [
          "http://127.0.0.1:8901/transcribe",
          "http://gpu:8901/transcribe",
        ],
      },
      tts: { endpoint: "http://127.0.0.1:8901/speak" },
      confidenceThreshold: 0.75,
      mock: true,
      pttKey: "KeyV",
    });
  });

  test("applies intent environment overrides", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_INTENT_ENABLED: "1",
        ASPEX_INTENT_ENDPOINTS: "http://127.0.0.1:11434, http://gpu:11434/",
        ASPEX_INTENT_MODEL: "llama3.1:8b",
        ASPEX_INTENT_MOCK: "true",
      },
    });

    expect(cfg.intent).toMatchObject({
      enabled: true,
      endpoints: ["http://127.0.0.1:11434", "http://gpu:11434"],
      model: "llama3.1:8b",
      mock: true,
      timeoutMs: 8000,
      elevateConfirm: true,
    });
  });

  test("applies adapter environment overrides", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_CODEX_ENABLED: "1",
        ASPEX_OPENCODE_ENABLED: "true",
        ASPEX_OPENCODE_SERVER_URL: "http://127.0.0.1:4096/",
        ASPEX_OPENCODE_DIRECTORY: "D:\\BroCorp\\Aspex",
        ASPEX_CURSOR_ENABLED: "true",
        ASPEX_CURSOR_SECRET: "cursor-secret",
      },
    });

    expect(cfg.adapters).toEqual({
      codex: { enabled: true },
      opencode: {
        enabled: true,
        serverUrl: "http://127.0.0.1:4096",
        directory: "D:\\BroCorp\\Aspex",
      },
      cursor: { enabled: true, secret: "cursor-secret" },
    });
  });

  test("validates enabled adapter config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-adapters-invalid-"));
    const opencodeUrlPath = join(dir, "opencode-url.json");
    const opencodeEmptyPath = join(dir, "opencode-empty.json");
    const cursorSecretPath = join(dir, "cursor-secret.json");

    await writeFile(
      opencodeUrlPath,
      JSON.stringify({
        adapters: { opencode: { enabled: true, serverUrl: "not-a-url" } },
      }),
    );
    await writeFile(
      opencodeEmptyPath,
      JSON.stringify({
        adapters: { opencode: { enabled: true, serverUrl: "" } },
      }),
    );
    await writeFile(
      cursorSecretPath,
      JSON.stringify({ adapters: { cursor: { enabled: true } } }),
    );

    try {
      await expect(
        loadConfig({ configPath: opencodeUrlPath, env: {} }),
      ).rejects.toThrow(
        "adapters.opencode.serverUrl must be a non-empty valid URL when opencode is enabled",
      );
      await expect(
        loadConfig({ configPath: opencodeEmptyPath, env: {} }),
      ).rejects.toThrow(
        "adapters.opencode.serverUrl must be a non-empty valid URL when opencode is enabled",
      );
      await expect(
        loadConfig({ configPath: cursorSecretPath, env: {} }),
      ).rejects.toThrow(
        "adapters.cursor.secret must be a non-empty string when cursor is enabled",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not validate opencode serverUrl while opencode is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-opencode-disabled-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        adapters: { opencode: { enabled: false, serverUrl: "not-a-url" } },
      }),
    );

    try {
      const cfg = await loadConfig({ configPath, env: {} });

      expect(cfg.adapters?.opencode).toMatchObject({
        enabled: false,
        serverUrl: "not-a-url",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("normalizes voice service base URLs to contract endpoints", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_VOICE_STT: "http://127.0.0.1:8901, http://gpu:8901/base/",
        ASPEX_VOICE_TTS: "http://127.0.0.1:8901",
      },
    });

    expect(cfg.voice?.stt.endpoints).toEqual([
      "http://127.0.0.1:8901/transcribe",
      "http://gpu:8901/base/transcribe",
    ]);
    expect(cfg.voice?.tts.endpoint).toBe("http://127.0.0.1:8901/speak");
  });

  test("merges config file before environment overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-config-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        hubPort: 4318,
        dbPath: "~/custom.sqlite",
        github: { token: "from-file", allowlist: ["owner/repo"] },
        liveness: { heartbeatGraceMs: 999 },
      }),
    );

    try {
      const cfg = await loadConfig({
        configPath,
        env: {
          ASPEX_HUB_PORT: "4319",
          ASPEX_GITHUB_TOKEN: "from-env",
        },
      });

      expect(cfg.hubPort).toBe(4319);
      expect(cfg.dbPath).toBe(expandHome("~/custom.sqlite"));
      expect(cfg.github).toEqual({
        token: "from-env",
        allowlist: ["owner/repo"],
      });
      expect(resolvedLivenessConfig(cfg)).toEqual({
        ...DEFAULT_CONFIG.liveness,
        heartbeatGraceMs: 999,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when an explicit config file is missing", async () => {
    await expect(
      loadConfig({ configPath: join(tmpdir(), "missing-aspex-config.json") }),
    ).rejects.toThrow("Config file not found");
  });

  test("does not create optional sections from env partials alone", async () => {
    const cfg = await loadConfig({
      defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
      env: {
        ASPEX_GITHUB_ALLOWLIST: "owner/repo",
        ASPEX_NTFY_SERVER: "https://ntfy.sh",
        ASPEX_NTFY_MIN_SEVERITY: "medium",
      },
    });

    expect(cfg.github).toBeUndefined();
    expect(cfg.ntfy).toBeUndefined();
  });

  test("applies env partials to optional sections already present in config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-config-partials-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        github: { token: "from-file" },
        ntfy: { topic: "from-file" },
      }),
    );

    try {
      const cfg = await loadConfig({
        configPath,
        env: {
          ASPEX_GITHUB_ALLOWLIST: "owner/repo",
          ASPEX_NTFY_SERVER: "https://ntfy.sh",
          ASPEX_NTFY_MIN_SEVERITY: "high",
        },
      });

      expect(cfg.github).toEqual({
        token: "from-file",
        allowlist: ["owner/repo"],
      });
      expect(cfg.ntfy).toEqual({
        topic: "from-file",
        server: "https://ntfy.sh",
        minSeverity: "high",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws on invalid environment overrides", async () => {
    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_HUB_PORT: "0" },
      }),
    ).rejects.toThrow("ASPEX_HUB_PORT must be a positive integer");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_MOCK: "sometimes" },
      }),
    ).rejects.toThrow("ASPEX_MOCK must be a boolean");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_GITHUB_TOKEN: "" },
      }),
    ).rejects.toThrow("ASPEX_GITHUB_TOKEN must be a non-empty string");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_DB_PATH: "" },
      }),
    ).rejects.toThrow("ASPEX_DB_PATH must be a non-empty string");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_VOICE_CONFIDENCE: "1.5" },
      }),
    ).rejects.toThrow("voice.confidenceThreshold must be between 0 and 1");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_PREVIEWS_ENABLED: "sometimes" },
      }),
    ).rejects.toThrow("ASPEX_PREVIEWS_ENABLED must be a boolean");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_PREVIEWS_ENGINE: "podman" },
      }),
    ).rejects.toThrow("ASPEX_PREVIEWS_ENGINE must be docker or mock");

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_PREVIEWS_MAX_CONCURRENT: "0" },
      }),
    ).rejects.toThrow(
      "ASPEX_PREVIEWS_MAX_CONCURRENT must be a positive integer",
    );

    await expect(
      loadConfig({
        defaultConfigPath: join(tmpdir(), `missing-aspex-${process.pid}.json`),
        env: { ASPEX_INTENT_ENABLED: "sometimes" },
      }),
    ).rejects.toThrow("ASPEX_INTENT_ENABLED must be a boolean");
  });

  test("rejects enabled real intent with no endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-intent-empty-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({ intent: { enabled: true, endpoints: [] } }),
    );

    try {
      await expect(loadConfig({ configPath, env: {} })).rejects.toThrow(
        "intent.endpoints must contain at least one endpoint when intent is enabled",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allows disabled real intent with no endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-intent-disabled-empty-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({ intent: { enabled: false, endpoints: [] } }),
    );

    try {
      const cfg = await loadConfig({ configPath, env: {} });

      expect(cfg.intent).toMatchObject({
        enabled: false,
        endpoints: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allows enabled mock intent with no endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-intent-mock-empty-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        intent: { enabled: true, mock: true, endpoints: [] },
      }),
    );

    try {
      const cfg = await loadConfig({ configPath, env: {} });

      expect(cfg.intent).toMatchObject({
        enabled: true,
        mock: true,
        endpoints: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("validates intent config shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-intent-shape-"));
    const timeoutConfigPath = join(dir, "timeout.json");
    const booleanConfigPath = join(dir, "boolean.json");

    await writeFile(
      timeoutConfigPath,
      JSON.stringify({ intent: { timeoutMs: 0 } }),
    );
    await writeFile(
      booleanConfigPath,
      JSON.stringify({ intent: { elevateConfirm: "true" } }),
    );

    try {
      await expect(
        loadConfig({ configPath: timeoutConfigPath, env: {} }),
      ).rejects.toThrow("intent.timeoutMs must be a positive integer");
      await expect(
        loadConfig({ configPath: booleanConfigPath, env: {} }),
      ).rejects.toThrow("intent.elevateConfirm must be a boolean");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("validates preview config shape without validating individual specs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-preview-config-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        previews: {
          enabled: true,
          engine: "mock",
          maxConcurrent: 2,
          limits: { cpus: "2", memory: "1g", idleTtlSec: 45 },
          specs: [{ id: "bad" }],
        },
      }),
    );

    try {
      const cfg = await loadConfig({ configPath, env: {} });

      expect(cfg.previews).toMatchObject({
        enabled: true,
        engine: "mock",
        maxConcurrent: 2,
        limits: { cpus: "2", memory: "1g", idleTtlSec: 45 },
      });
      expect(cfg.previews?.specs).toEqual([{ id: "bad" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when preview enabled is not a boolean in config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-preview-enabled-"));
    const configPath = join(dir, "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        previews: { enabled: "true" },
      }),
    );

    try {
      await expect(loadConfig({ configPath, env: {} })).rejects.toThrow(
        "previews.enabled must be a boolean",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when optional config sections are incomplete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-config-incomplete-"));
    const githubConfigPath = join(dir, "github.json");
    const ntfyConfigPath = join(dir, "ntfy.json");

    await writeFile(
      githubConfigPath,
      JSON.stringify({ github: { allowlist: ["owner/repo"] } }),
    );
    await writeFile(
      ntfyConfigPath,
      JSON.stringify({ ntfy: { server: "https://ntfy.sh" } }),
    );

    try {
      await expect(
        loadConfig({ configPath: githubConfigPath, env: {} }),
      ).rejects.toThrow(
        "github.token must be a non-empty string when github is configured",
      );

      await expect(
        loadConfig({ configPath: ntfyConfigPath, env: {} }),
      ).rejects.toThrow(
        "ntfy.topic must be a non-empty string when ntfy is configured",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("expandHome expands only home-prefixed paths", () => {
    expect(expandHome("relative.json")).toBe("relative.json");
    expect(expandHome("~")).not.toBe("~");
    expect(expandHome("~/aspex.json")).not.toContain("~");
  });
});
