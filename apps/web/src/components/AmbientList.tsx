import { useState } from "react";
import type { AttentionItem } from "../types";
import { ItemCard } from "./ItemCard";

interface AmbientListProps {
  items: AttentionItem[];
}

export function AmbientList({ items }: AmbientListProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t border-zinc-900 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Ambient
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Present, but not asking for action.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide" : `Show ${items.length}`}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-3">
          {items.length === 0 ? (
            <p className="rounded border border-zinc-900 bg-zinc-950 p-4 text-sm text-zinc-500">
              No ambient items yet.
            </p>
          ) : (
            items.map((item) => <ItemCard key={item.id} item={item} muted />)
          )}
        </div>
      ) : null}
    </section>
  );
}
