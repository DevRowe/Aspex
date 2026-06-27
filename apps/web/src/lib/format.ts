import type { Liveness, Reason } from "@aspex/schema";

export const reasonLabel = {
  blocked_on_human: "Blocked - needs you",
  failing_ci: "CI failing",
  review_requested: "Review requested",
  awaiting_merge: "Ready to merge",
  errored: "Errored",
  ambient: "",
} as const satisfies Record<Reason, string>;

export type ReasonAccent = "muted" | "neutralPositive" | "warm";

export function reasonAccent(reason: Reason): ReasonAccent {
  if (reason === "blocked_on_human" || reason === "failing_ci") {
    return "warm";
  }

  if (reason === "review_requested" || reason === "awaiting_merge") {
    return "neutralPositive";
  }

  return "muted";
}

export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const observed = Date.parse(iso);

  if (!Number.isFinite(observed)) {
    return "time unknown";
  }

  const deltaSeconds = Math.max(0, Math.floor((now - observed) / 1000));

  if (deltaSeconds < 5) {
    return "just now";
  }

  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);

  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);

  return `${deltaDays}d ago`;
}

export function formatLiveness(liveness: Liveness): string {
  return liveness;
}
