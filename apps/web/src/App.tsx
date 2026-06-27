import { useEffect } from "react";
import { connect } from "./lib/hubClient";
import { useStore } from "./store";

export function App() {
  const connected = useStore((state) => state.connected);
  const needsMeCount = useStore((state) => state.needsMe.length);
  const ambientCount = useStore((state) => state.ambient.length);

  useEffect(() => {
    const stream = connect();
    return () => {
      stream.close();
    };
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col justify-center gap-6">
        <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-zinc-300">
          <span
            className={[
              "size-3 rounded-full",
              connected ? "bg-emerald-400" : "bg-red-500",
            ].join(" ")}
            aria-hidden="true"
          />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Count label="Needs me" value={needsMeCount} />
          <Count label="Ambient" value={ambientCount} />
        </div>
      </section>
    </main>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-5">
      <div className="break-words text-sm font-medium uppercase text-zinc-400">
        {label}
      </div>
      <div className="mt-3 text-5xl font-semibold leading-none tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}
