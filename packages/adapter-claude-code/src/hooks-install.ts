import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CLAUDE_CODE_HOOK_EVENTS, type ClaudeCodeHookEvent } from "./index";

const ASPEX_COMMAND_PREFIX = "aspex hook-relay --event";

export interface HookSettingsOptions {
  configDir?: string;
  now?: Date;
}

export interface HookSettingsResult {
  settingsPath: string;
  backupPath: string | null;
}

export async function installClaudeCodeHooks(
  options: HookSettingsOptions = {},
): Promise<HookSettingsResult> {
  const settingsPath = settingsPathFor(options.configDir);
  const settings = await readSettings(settingsPath);
  const next = withAspexHooks(settings);
  const backupPath = existsSync(settingsPath)
    ? backupPathFor(settingsPath, options.now ?? new Date())
    : null;

  await writeSettings(settingsPath, next, options.now);

  return {
    settingsPath,
    backupPath,
  };
}

export async function uninstallClaudeCodeHooks(
  options: HookSettingsOptions = {},
): Promise<HookSettingsResult> {
  const settingsPath = settingsPathFor(options.configDir);
  const settings = await readSettings(settingsPath);
  const next = withoutAspexHooks(settings);
  const backupPath = existsSync(settingsPath)
    ? backupPathFor(settingsPath, options.now ?? new Date())
    : null;

  await writeSettings(settingsPath, next, options.now);

  return {
    settingsPath,
    backupPath,
  };
}

export function settingsPathFor(configDir?: string): string {
  return join(
    configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    "settings.json",
  );
}

export function withAspexHooks(settings: unknown): Record<string, unknown> {
  const root = isRecord(settings) ? cloneRecord(settings) : {};
  const hooks = isRecord(root.hooks) ? cloneRecord(root.hooks) : {};

  for (const event of CLAUDE_CODE_HOOK_EVENTS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...removeAspexEntries(current), aspexHookEntry(event)];
  }

  root.hooks = hooks;
  return root;
}

export function withoutAspexHooks(settings: unknown): Record<string, unknown> {
  const root = isRecord(settings) ? cloneRecord(settings) : {};

  if (!isRecord(root.hooks)) {
    return root;
  }

  const hooks: Record<string, unknown> = {};

  for (const [event, entries] of Object.entries(root.hooks)) {
    if (!Array.isArray(entries)) {
      hooks[event] = entries;
      continue;
    }

    const filtered = removeAspexEntries(entries);

    if (filtered.length > 0) {
      hooks[event] = filtered;
    }
  }

  if (Object.keys(hooks).length === 0) {
    const { hooks: _hooks, ...withoutHooks } = root;

    return withoutHooks;
  }

  root.hooks = hooks;
  return root;
}

async function readSettings(
  settingsPath: string,
): Promise<Record<string, unknown>> {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const raw = await readFile(settingsPath, "utf8");
  const parsed = raw.trim() === "" ? {} : JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error("Claude Code settings.json must contain a JSON object");
  }

  return parsed;
}

async function writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });

  if (existsSync(settingsPath)) {
    await copyFile(settingsPath, backupPathFor(settingsPath, now));
  }

  await writeFile(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}

function backupPathFor(settingsPath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `${settingsPath}.aspex-backup-${stamp}`;
}

function aspexHookEntry(event: ClaudeCodeHookEvent): Record<string, unknown> {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `${ASPEX_COMMAND_PREFIX} ${event}`,
      },
    ],
  };
}

function removeAspexEntries(entries: unknown[]): unknown[] {
  return entries
    .map(removeAspexCommands)
    .filter((entry) => !isEmptyHookEntry(entry));
}

function removeAspexCommands(entry: unknown): unknown {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return entry;
  }

  return {
    ...entry,
    hooks: entry.hooks.filter((hook) => !isAspexHookCommand(hook)),
  };
}

function isAspexHookCommand(hook: unknown): boolean {
  return (
    isRecord(hook) &&
    typeof hook.command === "string" &&
    hook.command.includes(ASPEX_COMMAND_PREFIX)
  );
}

function isEmptyHookEntry(entry: unknown): boolean {
  return (
    isRecord(entry) && Array.isArray(entry.hooks) && entry.hooks.length === 0
  );
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
