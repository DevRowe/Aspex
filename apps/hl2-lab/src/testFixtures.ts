import type { AttentionItem } from "@aspex/schema";
import type { RankedState } from "./domain";

export function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "orchestrator:giles:lab-one",
    source: "orchestrator",
    project: "Aspex",
    actor: "giles-worker/codex",
    state: "blocked",
    liveness: "live",
    reason: "blocked_on_human",
    attentionRequired: true,
    severity: "high",
    summary: "Owner choice needed before the worker can continue.",
    evidence: [{ label: "Decision", text: "Choose the safe path." }],
    actions: [
      {
        id: "answer",
        label: "Answer",
        risk: "safe",
        requiresConfirmation: false,
      },
      {
        id: "redirect",
        label: "Redirect",
        risk: "medium",
        requiresConfirmation: true,
      },
    ],
    observedAt: "2026-07-10T00:00:00.000Z",
    staleAfter: "2026-07-10T00:01:00.000Z",
    ...overrides,
  };
}

export function ranked(overrides: Partial<RankedState> = {}): RankedState {
  return {
    needsMe: [item()],
    overflow: [],
    ambient: [],
    generatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}
