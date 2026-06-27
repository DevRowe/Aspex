import { formatLastSeen } from "../lib/format";
import { useStore } from "../store";
import type { AttentionItem } from "../types";
import { LivenessChip } from "./LivenessChip";
import { ReasonBadge } from "./ReasonBadge";

interface ItemCardProps {
  item: AttentionItem;
  muted?: boolean;
}

export function ItemCard({ item, muted = false }: ItemCardProps) {
  const selectedId = useStore((state) => state.selectedId);
  const setSelectedId = useStore((state) => state.setSelectedId);
  const topAction = item.actions[0];
  const selected = selectedId === item.id;
  const select = () => setSelectedId(item.id);

  return (
    <button
      type="button"
      className={[
        "block w-full rounded border p-4 text-left transition-colors",
        "focus:border-zinc-500 focus:outline-none",
        muted
          ? "border-zinc-900 bg-zinc-950/40"
          : "border-zinc-800 bg-zinc-900/80",
        selected ? "border-zinc-500 bg-zinc-900" : "",
      ].join(" ")}
      onClick={select}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ReasonBadge reason={item.reason} />
        <LivenessChip
          state={item.state}
          liveness={item.liveness}
          observedAt={item.observedAt}
        />
      </div>

      <h2
        className={[
          "mt-3 break-words text-base font-semibold leading-6",
          muted ? "text-zinc-300" : "text-zinc-100",
        ].join(" ")}
      >
        {item.summary}
      </h2>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-400">
        <span className="break-words">{item.project}</span>
        {item.actor ? <span className="break-words">{item.actor}</span> : null}
        <span>{formatLastSeen(item.observedAt)}</span>
      </div>

      {topAction ? (
        <div className="mt-4 inline-flex max-w-full rounded border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300">
          <span className="truncate">Top action: {topAction.label}</span>
        </div>
      ) : null}
    </button>
  );
}
