import { useState } from "react";
import { useStore } from "../store";
import { AmbientList } from "./AmbientList";
import { ItemCard } from "./ItemCard";
import { ItemDetail } from "./ItemDetail";

export function Inbox() {
  const needsMe = useStore((state) => state.needsMe);
  const overflow = useStore((state) => state.overflow);
  const ambient = useStore((state) => state.ambient);
  const connected = useStore((state) => state.connected);
  const selectedId = useStore((state) => state.selectedId);
  const [showOverflow, setShowOverflow] = useState(false);
  const visibleNeedsMe = showOverflow ? [...needsMe, ...overflow] : needsMe;
  const selectedItem =
    [...needsMe, ...overflow, ...ambient].find(
      (item) => item.id === selectedId,
    ) ?? null;

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold leading-tight text-zinc-50 sm:text-3xl">
              What needs me
            </h1>
          </div>

          <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <span
              className={[
                "size-2.5 rounded-full",
                connected ? "bg-emerald-400" : "bg-zinc-600",
              ].join(" ")}
              aria-hidden="true"
            />
            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start">
          <div className="grid gap-8">
            <section className="grid gap-3" aria-label="Needs me">
              {visibleNeedsMe.length === 0 ? (
                <div className="rounded border border-zinc-800 bg-zinc-900/70 p-5">
                  <h2 className="text-base font-semibold text-zinc-100">
                    Nothing needs you right now.
                  </h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Working and completed items stay below in Ambient when
                    present.
                  </p>
                </div>
              ) : (
                visibleNeedsMe.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))
              )}
            </section>

            {overflow.length > 0 ? (
              <button
                type="button"
                className="w-full rounded border border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                onClick={() => setShowOverflow((value) => !value)}
              >
                {showOverflow ? "Show fewer" : `Show ${overflow.length} more`}
              </button>
            ) : null}

            <AmbientList items={ambient} />
          </div>

          {selectedItem ? (
            <ItemDetail key={selectedItem.id} item={selectedItem} />
          ) : (
            <aside className="rounded border border-zinc-900 bg-zinc-950/40 p-4 text-sm text-zinc-500">
              Select an Item to inspect evidence and actions.
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
