import type { Preview, PreviewSpec } from "@aspex/schema";
import { useEffect, useRef, useState } from "react";
import { usePreviewStore } from "./usePreviews";

interface PreviewTileProps {
  preview: Preview;
  spec?: PreviewSpec;
}

export function PreviewTile({ preview, spec }: PreviewTileProps) {
  const tileRef = useRef<HTMLElement | null>(null);
  const focusedPreviewId = usePreviewStore((state) => state.focusedPreviewId);
  const stopPreviewAction = usePreviewStore((state) => state.stopPreview);
  const rebootPreviewAction = usePreviewStore((state) => state.rebootPreview);
  const [actionError, setActionError] = useState<string | null>(null);
  const name = spec?.name ?? preview.specId;
  const isFocused = focusedPreviewId === preview.previewId;
  const isReadyTrusted =
    preview.state === "ready" &&
    preview.trust === "trusted" &&
    preview.url !== undefined;

  useEffect(() => {
    if (isFocused) {
      tileRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      tileRef.current?.focus({ preventScroll: true });
    }
  }, [isFocused]);

  const stopPreview = async () => {
    setActionError(null);

    try {
      await stopPreviewAction(preview.previewId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Stop failed");
    }
  };

  const rebootPreview = async () => {
    setActionError(null);

    try {
      await rebootPreviewAction(preview);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Re-boot failed");
    }
  };

  const openPreview = () => {
    if (preview.url !== undefined) {
      window.open(preview.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <article
      ref={tileRef}
      className={[
        "grid min-h-[20rem] overflow-hidden rounded border bg-zinc-950/50",
        isFocused
          ? "border-emerald-500/70"
          : preview.state === "stopped"
            ? "border-zinc-900 opacity-70"
            : "border-zinc-800",
      ].join(" ")}
      data-preview-id={preview.previewId}
      data-focused={isFocused ? "true" : undefined}
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-900 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-100">
            {name}
          </h3>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500">
            {preview.state}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {preview.state !== "stopped" ? (
            <button
              type="button"
              className="rounded border border-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
              onClick={stopPreview}
            >
              Stop
            </button>
          ) : null}
          {preview.state === "crashed" || preview.state === "stopped" ? (
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-500"
              onClick={rebootPreview}
            >
              Re-boot
            </button>
          ) : null}
          {preview.url !== undefined ? (
            <button
              type="button"
              className="rounded border border-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
              onClick={openPreview}
            >
              Open in tab
            </button>
          ) : null}
        </div>
        {actionError ? (
          <p className="basis-full text-xs text-red-300">{actionError}</p>
        ) : null}
      </div>

      <div className="min-h-0">
        {preview.state === "booting" ? (
          <div className="grid h-full min-h-[16rem] place-items-center px-4 text-center text-sm text-zinc-400">
            <div>
              <div className="mx-auto mb-3 size-6 rounded-full border-2 border-zinc-700 border-t-emerald-400" />
              Booting {name}
            </div>
          </div>
        ) : null}

        {isReadyTrusted ? (
          <iframe
            title={`Preview: ${name}`}
            src={preview.url}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="no-referrer"
            allow=""
            className="h-[22rem] w-full bg-white"
          />
        ) : null}

        {preview.state === "ready" && !isReadyTrusted ? (
          <TileMessage
            title="Preview unavailable"
            message="pixels lane not yet available"
          />
        ) : null}

        {preview.state === "crashed" ? (
          <TileMessage
            title="Preview crashed"
            message={preview.message ?? "The Preview exited unexpectedly."}
          />
        ) : null}

        {preview.state === "stopped" ? (
          <TileMessage
            title="Preview stopped"
            message={preview.message ?? "This Preview is no longer running."}
          />
        ) : null}
      </div>
    </article>
  );
}

function TileMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="grid h-full min-h-[16rem] place-items-center px-4 text-center">
      <div>
        <h4 className="text-sm font-semibold text-zinc-200">{title}</h4>
        <p className="mt-2 max-w-sm text-sm text-zinc-400">{message}</p>
      </div>
    </div>
  );
}
