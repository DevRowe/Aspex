import { useMemo, useState } from "react";
import { PreviewTile } from "./PreviewTile";
import { usePreviewStore } from "./usePreviews";

export function Deck() {
  const specs = usePreviewStore((state) => state.specs);
  const previews = usePreviewStore((state) => state.previews);
  const loading = usePreviewStore((state) => state.loading);
  const error = usePreviewStore((state) => state.error);
  const bootSpec = usePreviewStore((state) => state.bootSpec);
  const [bootingSpecId, setBootingSpecId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const specsById = useMemo(
    () => new Map(specs.map((spec) => [spec.id, spec])),
    [specs],
  );

  const onBootSpec = async (specId: string) => {
    setBootingSpecId(specId);
    setBootError(null);

    try {
      await bootSpec(specId);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Boot failed");
    } finally {
      setBootingSpecId(null);
    }
  };

  return (
    <section className="grid gap-4" aria-label="Preview Deck">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Preview Deck</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Disposable previews stay outside the world-model.
          </p>
        </div>
        {loading ? (
          <span className="text-sm text-zinc-500">Loading</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-400">
          {error}
        </div>
      ) : null}

      <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {specs.length === 0 ? (
            <p className="text-sm text-zinc-500">No Preview specs declared.</p>
          ) : (
            specs.map((spec) => {
              const disabled = spec.trust !== "trusted";
              const isBooting = bootingSpecId === spec.id;

              return (
                <div
                  key={spec.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-200">
                      {spec.name}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {disabled
                        ? "pixels lane not yet available"
                        : `${spec.engine} :${spec.port}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={[
                      "rounded border px-2.5 py-1.5 text-xs font-medium",
                      disabled
                        ? "cursor-not-allowed border-zinc-900 text-zinc-600"
                        : "border-zinc-700 text-zinc-100 hover:border-zinc-500",
                    ].join(" ")}
                    disabled={disabled || isBooting}
                    onClick={() => void onBootSpec(spec.id)}
                  >
                    {isBooting ? "Booting" : "Boot"}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {bootError ? (
          <p className="mt-3 text-sm text-red-300">{bootError}</p>
        ) : null}
      </div>

      {previews.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {previews.map((preview) => (
            <PreviewTile
              key={preview.previewId}
              preview={preview}
              spec={specsById.get(preview.specId)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
