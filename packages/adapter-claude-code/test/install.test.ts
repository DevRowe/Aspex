import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installClaudeCodeHooks,
  uninstallClaudeCodeHooks,
  withAspexHooks,
} from "../src/hooks-install";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe("Claude Code hook installer", () => {
  test("install is idempotent and uninstall preserves non-Aspex hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-claude-hooks-"));
    tempDirs.push(dir);
    const settingsPath = join(dir, "settings.json");
    const original = {
      theme: "dark",
      hooks: {
        Notification: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "notify-me" }],
          },
        ],
      },
    };

    await writeFile(
      settingsPath,
      `${JSON.stringify(original, null, 2)}\n`,
      "utf8",
    );

    const installResult = await installClaudeCodeHooks({
      configDir: dir,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const installedOnce = await readFile(settingsPath, "utf8");
    const secondInstallResult = await installClaudeCodeHooks({
      configDir: dir,
      now: new Date("2026-01-01T00:00:01Z"),
    });
    const installedTwice = await readFile(settingsPath, "utf8");

    expect(installResult.backupPath).not.toBeNull();
    expect(existsSync(installResult.backupPath ?? "")).toBe(true);
    expect(
      JSON.parse(await readFile(installResult.backupPath ?? "", "utf8")),
    ).toEqual(original);
    expect(secondInstallResult.backupPath).not.toBeNull();
    expect(existsSync(secondInstallResult.backupPath ?? "")).toBe(true);
    expect(JSON.parse(installedTwice)).toEqual(JSON.parse(installedOnce));
    expect(installedTwice.match(/aspex hook-relay/g)).toHaveLength(4);

    await uninstallClaudeCodeHooks({
      configDir: dir,
      now: new Date("2026-01-01T00:00:02Z"),
    });

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(original);
  });

  test("withAspexHooks creates only the four accepted hooks", () => {
    const settings = withAspexHooks({});

    expect(
      Object.keys(settings.hooks as Record<string, unknown>).sort(),
    ).toEqual(["Notification", "PostToolUse", "Stop", "SubagentStop"]);
  });

  test("install then uninstall round-trips empty settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-claude-hooks-"));
    tempDirs.push(dir);
    const settingsPath = join(dir, "settings.json");

    await writeFile(settingsPath, "{}\n", "utf8");
    await installClaudeCodeHooks({ configDir: dir });
    await uninstallClaudeCodeHooks({ configDir: dir });

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({});
  });
});
