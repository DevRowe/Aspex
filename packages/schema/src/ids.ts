import type { ItemId } from "./types";

export const githubPrId = (repo: string, number: number): ItemId =>
  `github:pr:${repo}#${number}`;

export const claudeSessionId = (sessionId: string): ItemId =>
  `claude-code:session:${sessionId}`;

export const codexSessionId = (threadId: string): ItemId =>
  `codex:session:${threadId}`;

export const webhookId = (key: string): ItemId => `webhook:${key}`;

export function parseItemId(
  id: ItemId,
): { source: string; kind: string; rest: string } | null {
  const firstSeparator = id.indexOf(":");

  if (firstSeparator <= 0) {
    return null;
  }

  const secondSeparator = id.indexOf(":", firstSeparator + 1);

  if (secondSeparator <= firstSeparator + 1) {
    return null;
  }

  const rest = id.slice(secondSeparator + 1);

  if (rest.length === 0) {
    return null;
  }

  return {
    source: id.slice(0, firstSeparator),
    kind: id.slice(firstSeparator + 1, secondSeparator),
    rest,
  };
}
