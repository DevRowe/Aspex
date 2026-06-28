import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installCodexNotify,
  uninstallCodexNotify,
  withAspexCodexNotify,
  withoutAspexCodexNotify,
} from "../src";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe("Codex notify installer", () => {
  test("install is idempotent and uninstall round-trips unrelated config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspex-codex-notify-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.toml");
    const original = 'model = "gpt-5"\napproval_policy = "on-request"\n';

    await writeFile(configPath, original, "utf8");

    const installResult = await installCodexNotify({
      configPath,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const installedOnce = await readFile(configPath, "utf8");
    const secondInstallResult = await installCodexNotify({
      configPath,
      now: new Date("2026-01-01T00:00:01Z"),
    });
    const installedTwice = await readFile(configPath, "utf8");

    expect(installResult.backupPath).not.toBeNull();
    expect(existsSync(installResult.backupPath ?? "")).toBe(true);
    expect(await readFile(installResult.backupPath ?? "", "utf8")).toBe(
      original,
    );
    expect(secondInstallResult.backupPath).toBeNull();
    expect(installedTwice).toBe(installedOnce);
    expect(
      installedTwice.match(/aspex", "hook-relay", "--source", "codex"/g),
    ).toHaveLength(1);

    const uninstallResult = await uninstallCodexNotify({
      configPath,
      now: new Date("2026-01-01T00:00:02Z"),
    });
    const secondUninstallResult = await uninstallCodexNotify({
      configPath,
      now: new Date("2026-01-01T00:00:03Z"),
    });

    expect(uninstallResult.backupPath).not.toBeNull();
    expect(secondUninstallResult.backupPath).toBeNull();
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  test("install replaces an existing top-level notify entry", () => {
    const installed = withAspexCodexNotify(
      'model = "gpt-5"\nnotify = ["old"]\n',
    );

    expect(installed).toBe(
      'model = "gpt-5"\nnotify = ["aspex", "hook-relay", "--source", "codex"]\n',
    );
  });

  test("install then uninstall preserves missing trailing newline", () => {
    const original = 'model = "gpt-5"';

    expect(withoutAspexCodexNotify(withAspexCodexNotify(original))).toBe(
      original,
    );
  });

  test("uninstall ignores unrelated notify entries", () => {
    const config = 'notify = ["other"]\n';

    expect(withoutAspexCodexNotify(config)).toBe(config);
  });
});
