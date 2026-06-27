import type { Reason } from "@aspex/schema";
import { reasonAccent, reasonLabel } from "../lib/format";

interface ReasonBadgeProps {
  reason: Reason;
}

const accentClass = {
  muted: "border-zinc-700 bg-zinc-900 text-zinc-400",
  neutralPositive: "border-emerald-800/70 bg-emerald-950/40 text-emerald-200",
  warm: "border-amber-700/70 bg-amber-950/50 text-amber-200",
};

export function ReasonBadge({ reason }: ReasonBadgeProps) {
  const label = reasonLabel[reason] || reason;

  if (label.length === 0) {
    return null;
  }

  return (
    <span
      className={[
        "inline-flex max-w-full items-center rounded border px-2 py-1 text-xs font-medium leading-none",
        "break-words",
        accentClass[reasonAccent(reason)],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
