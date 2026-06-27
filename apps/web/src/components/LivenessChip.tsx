import type { Liveness, State } from "@aspex/schema";
import { formatLastSeen, formatStateLiveness } from "../lib/format";

interface LivenessChipProps {
  state: State;
  liveness: Liveness;
  observedAt: string;
}

const treatmentClass = {
  live: "border-emerald-800/70 bg-emerald-950/30 text-emerald-200",
  quiet: "border-zinc-700 bg-zinc-900/80 text-zinc-300 opacity-85",
  stale: "border-amber-800/70 bg-amber-950/30 text-amber-200 opacity-75",
  lost: "border-zinc-700 bg-zinc-950 text-zinc-400 opacity-60",
} as const satisfies Record<Liveness, string>;

const dotClass = {
  live: "bg-emerald-400",
  quiet: "bg-zinc-500",
  stale: "bg-amber-400",
  lost: "bg-zinc-600",
} as const satisfies Record<Liveness, string>;

export function LivenessChip({
  state,
  liveness,
  observedAt,
}: LivenessChipProps) {
  const showLastSeen = liveness === "stale" || liveness === "lost";

  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-2 rounded border px-2 py-1 text-xs font-medium leading-none",
        treatmentClass[liveness],
      ].join(" ")}
    >
      <span
        className={["size-1.5 shrink-0 rounded-full", dotClass[liveness]].join(
          " ",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 break-words">
        {formatStateLiveness(state, liveness)}
        {showLastSeen ? (
          <span className="font-normal"> - {formatLastSeen(observedAt)}</span>
        ) : null}
      </span>
    </span>
  );
}
