import type { ItemId } from "./types";

export const githubItemId = (pr: {
  owner: string;
  repo: string;
  number: number;
}): ItemId => `github:pr:${pr.owner}/${pr.repo}#${pr.number}`;

export const claudeSessionId = (sessionId: string): ItemId =>
  `claude-code:session:${sessionId}`;

export const codexSessionId = (threadId: string): ItemId =>
  `codex:session:${threadId}`;

export const cursorAgentId = (agentId: string): ItemId =>
  `cursor:agent:${agentId}`;

export const openCodeSessionId = (sessionId: string): ItemId =>
  `opencode:session:${sessionId}`;

export const webhookId = (key: string): ItemId => `webhook:${key}`;

// Orchestrator items are `orchestrator:<orchId>:<taskId>` so the generic
// parser yields source="orchestrator" and kind=<orchId> (which orchestrator
// owns the item, e.g. "giles").
export const orchestratorItemId = (orchId: string, taskId: string): ItemId =>
  `orchestrator:${orchId}:${taskId}`;

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
