import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ASPEX_NOTIFY_ENTRY =
  'notify = ["aspex", "hook-relay", "--source", "codex"]';
const ASPEX_NOTIFY_MATCH =
  /notify\s*=\s*\[[^\n#\]]*"aspex"[^\n#\]]*"hook-relay"[^\n#\]]*"--source"[^\n#\]]*"codex"[^\n#\]]*\]/;
const TOP_LEVEL_NOTIFY_LINE = /^notify\s*=\s*\[[^\n]*\]\r?$/m;

export interface CodexConfigOptions {
  configPath?: string;
  configDir?: string;
  now?: Date;
}

export interface CodexConfigResult {
  configPath: string;
  backupPath: string | null;
}

export async function installCodexNotify(
  options: CodexConfigOptions = {},
): Promise<CodexConfigResult> {
  const configPath = codexConfigPathFor(options);
  const original = await readConfig(configPath);
  const next = withAspexCodexNotify(original);
  const changed = next !== original;
  const backupPath =
    changed && existsSync(configPath)
      ? backupPathFor(configPath, options.now ?? new Date())
      : null;

  if (changed || !existsSync(configPath)) {
    await writeConfig(configPath, next, options.now);
  }

  return { configPath, backupPath };
}

export async function uninstallCodexNotify(
  options: CodexConfigOptions = {},
): Promise<CodexConfigResult> {
  const configPath = codexConfigPathFor(options);
  const original = await readConfig(configPath);
  const next = withoutAspexCodexNotify(original);
  const changed = next !== original;
  const backupPath =
    changed && existsSync(configPath)
      ? backupPathFor(configPath, options.now ?? new Date())
      : null;

  if (changed || !existsSync(configPath)) {
    await writeConfig(configPath, next, options.now);
  }

  return { configPath, backupPath };
}

export function codexConfigPathFor(options: CodexConfigOptions = {}): string {
  return (
    options.configPath ??
    join(
      options.configDir ??
        process.env.CODEX_CONFIG_DIR ??
        join(homedir(), ".codex"),
      "config.toml",
    )
  );
}

export function withAspexCodexNotify(config: string): string {
  const normalized = config.replace(/\r\n/g, "\n");

  if (ASPEX_NOTIFY_MATCH.test(normalized)) {
    return config;
  }

  const withNotify = TOP_LEVEL_NOTIFY_LINE.test(normalized)
    ? normalized.replace(TOP_LEVEL_NOTIFY_LINE, ASPEX_NOTIFY_ENTRY)
    : appendLine(normalized, ASPEX_NOTIFY_ENTRY);

  return config.includes("\r\n")
    ? withNotify.replace(/\n/g, "\r\n")
    : withNotify;
}

export function withoutAspexCodexNotify(config: string): string {
  const normalized = config.replace(/\r\n/g, "\n");

  if (!ASPEX_NOTIFY_MATCH.test(normalized)) {
    return config;
  }

  const withoutNotify = normalized
    .split("\n")
    .filter((line) => !ASPEX_NOTIFY_MATCH.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return config.includes("\r\n")
    ? withoutNotify.replace(/\n/g, "\r\n")
    : withoutNotify;
}

async function readConfig(configPath: string): Promise<string> {
  if (!existsSync(configPath)) {
    return "";
  }

  return readFile(configPath, "utf8");
}

async function writeConfig(
  configPath: string,
  config: string,
  now = new Date(),
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) {
    await copyFile(configPath, backupPathFor(configPath, now));
  }

  await writeFile(configPath, config, "utf8");
}

function appendLine(config: string, line: string): string {
  if (config.length === 0) {
    return `${line}\n`;
  }

  return config.endsWith("\n") ? `${config}${line}\n` : `${config}\n${line}`;
}

function backupPathFor(configPath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `${configPath}.aspex-backup-${stamp}`;
}
