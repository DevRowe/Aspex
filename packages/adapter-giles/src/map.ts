import type {
  Action,
  Evidence,
  Reason,
  Severity,
  Signal,
  State,
} from "@aspex/schema";
import { orchestratorItemId } from "@aspex/schema";
import type { GilesStatusEvent, GilesTaskRef, GilesWorkerState } from "./state";

// The design's section 2.3 lifecycle table: every Giles rung maps onto the
// EXISTING State/Reason/Severity vocabulary - zero new enum members.

export const GILES_ACTIONS = {
  status: {
    id: "status",
    label: "Status",
    risk: "safe",
    requiresConfirmation: false,
  },
  answer: {
    id: "answer",
    label: "Answer",
    risk: "safe",
    requiresConfirmation: false,
  },
  redirect: {
    id: "redirect",
    label: "Redirect",
    risk: "medium",
    requiresConfirmation: true,
  },
  approve: {
    id: "approve",
    label: "Approve",
    risk: "medium",
    requiresConfirmation: true,
  },
  deny: {
    id: "deny",
    label: "Request changes",
    risk: "medium",
    requiresConfirmation: true,
  },
  ship: {
    id: "ship",
    label: "Review & ship",
    risk: "dangerous",
    requiresConfirmation: true,
  },
} as const satisfies Record<string, Action>;

export type GilesActionId = keyof typeof GILES_ACTIONS;

export interface GilesTaskSnapshot {
  ref: GilesTaskRef;
  workerState: GilesWorkerState;
  meta: Record<string, string>;
  lastStatus: GilesStatusEvent | null;
}

interface Rung {
  state: State;
  reason: Reason;
  attentionRequired: boolean;
  severity: Severity;
  actions: GilesActionId[];
}

const SUMMARY_MAX = 240;

export function mapGilesTask(orchId: string, task: GilesTaskSnapshot): Signal {
  const rung = rungFor(task);
  const pr = task.meta.pr;
  const worktree = task.meta.worktree;
  const evidence: Evidence[] = [];
  const detail = task.workerState.detail;

  if (detail !== "") {
    evidence.push({ label: "Detail", text: detail });
  }

  if (
    task.lastStatus !== null &&
    task.lastStatus.text !== "" &&
    task.lastStatus.text !== detail
  ) {
    evidence.push({
      label: task.lastStatus.verb === "needs-decision" ? "Decision" : "Status",
      text: task.lastStatus.text,
    });
  }

  if (pr !== undefined && pr !== "") {
    evidence.push({ label: "PR", url: pr });
  }

  evidence.push({ label: "Task", text: task.ref.taskId });

  const deepLink =
    pr !== undefined && pr !== ""
      ? pr
      : worktree !== undefined && worktree !== ""
        ? worktree
        : undefined;

  return {
    id: orchestratorItemId(orchId, task.ref.taskId),
    source: "orchestrator",
    project: projectFor(task),
    ...(task.meta.harness !== undefined && task.meta.harness !== ""
      ? { actor: `giles-worker/${task.meta.harness}` }
      : { actor: "giles-worker" }),
    state: rung.state,
    reason: rung.reason,
    attentionRequired: rung.attentionRequired,
    severity: rung.severity,
    summary: summaryFor(task),
    evidence,
    actions: rung.actions.map((id) => GILES_ACTIONS[id]),
    ...(deepLink !== undefined ? { deepLink } : {}),
  };
}

// A task that left `## In flight` (merged / torn down) decays out as a
// terminal ambient done.
export function mapDepartedGilesTask(orchId: string, taskId: string): Signal {
  return {
    id: orchestratorItemId(orchId, taskId),
    source: "orchestrator",
    state: "done",
    reason: "ambient",
    attentionRequired: false,
    severity: "info",
    actions: [],
  };
}

function rungFor(task: GilesTaskSnapshot): Rung {
  const scout = (task.meta.kind ?? task.ref.kind) === "scout";
  const hasPr = task.meta.pr !== undefined && task.meta.pr !== "";
  const statusVerb = task.lastStatus?.verb;

  switch (task.workerState.state) {
    case "working":
      return {
        state: "working",
        reason: "ambient",
        attentionRequired: false,
        severity: "info",
        actions: ["redirect", "status"],
      };
    case "parked":
      // A genuinely parked run plus a needs-decision/blocked log agree: the
      // worker waits on a human answer, not on a no-mistakes gate.
      if (statusVerb === "needs-decision" || statusVerb === "blocked") {
        return blockedRung();
      }

      return {
        state: "needs_review",
        reason: "review_requested",
        attentionRequired: true,
        severity: "medium",
        actions: ["approve", "deny", "redirect"],
      };
    case "blocked":
      return blockedRung();
    case "done":
      if (scout) {
        return {
          state: "needs_review",
          reason: "review_requested",
          attentionRequired: true,
          severity: "low",
          actions: ["status"],
        };
      }

      if (hasPr) {
        return {
          state: "needs_review",
          reason: "awaiting_merge",
          attentionRequired: true,
          severity: "medium",
          actions: ["ship", "deny", "redirect"],
        };
      }

      return {
        state: "needs_review",
        reason: "review_requested",
        attentionRequired: true,
        severity: "medium",
        actions: ["status", "redirect"],
      };
    case "failed":
      return {
        state: "error",
        reason: "errored",
        attentionRequired: true,
        severity: "high",
        actions: ["status", "redirect"],
      };
    case "unknown":
      // Pre-validation or between reads; keep the task visible and ambient.
      return {
        state: "working",
        reason: "ambient",
        attentionRequired: false,
        severity: "info",
        actions: ["status"],
      };
  }
}

function blockedRung(): Rung {
  return {
    state: "blocked",
    reason: "blocked_on_human",
    attentionRequired: true,
    severity: "high",
    actions: ["answer", "redirect"],
  };
}

function projectFor(task: GilesTaskSnapshot): string {
  const metaProject = task.meta.project;

  if (metaProject !== undefined && metaProject !== "") {
    const basename = metaProject.replace(/\/+$/, "").split("/").at(-1);

    if (basename !== undefined && basename !== "") {
      return basename;
    }
  }

  return task.ref.repo ?? "giles";
}

// One human line, never a raw diff: prefer the worker's own status note, fall
// back to the backlog title.
function summaryFor(task: GilesTaskSnapshot): string {
  const note = task.lastStatus?.text ?? "";
  const summary = note !== "" ? note : task.ref.title;

  return summary.length > SUMMARY_MAX
    ? `${summary.slice(0, SUMMARY_MAX - 1)}…`
    : summary;
}
