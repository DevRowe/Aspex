import type { VoiceResult } from "@aspex/schema";
import { useEffect } from "react";
import type { PushToTalkPhase } from "../voice/usePushToTalk";
import { usePushToTalk } from "../voice/usePushToTalk";

interface PttButtonProps {
  enabled?: boolean;
  onResult?: (result: VoiceResult) => void;
  onPhaseChange?: (phase: PushToTalkPhase) => void;
  onError?: (error: string | undefined) => void;
  onReadback?: (readback: string | undefined) => void;
}

const phaseLabel = {
  idle: "Hold to talk",
  listening: "Listening",
  sending: "Sending",
  error: "Voice error",
} as const;

export function PttButton({
  enabled = true,
  onResult,
  onPhaseChange,
  onError,
  onReadback,
}: PttButtonProps) {
  const ptt = usePushToTalk({ enabled, onResult });

  useEffect(() => {
    onPhaseChange?.(ptt.phase);
  }, [onPhaseChange, ptt.phase]);

  useEffect(() => {
    onError?.(ptt.error);
  }, [onError, ptt.error]);

  useEffect(() => {
    onReadback?.(ptt.readback);
  }, [onReadback, ptt.readback]);

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <button
        type="button"
        className={[
          "rounded border px-3 py-2 text-sm font-medium transition",
          !enabled
            ? "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-600"
            : ptt.isActive
              ? "border-emerald-400 bg-emerald-400 text-zinc-950"
              : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500",
        ].join(" ")}
        aria-label="Hold to talk"
        aria-pressed={ptt.isActive}
        disabled={!enabled}
        {...ptt.buttonProps}
      >
        {enabled ? phaseLabel[ptt.phase] : "Voice off"}
      </button>
      <span
        className="max-w-64 truncate text-right text-xs text-zinc-400"
        role={ptt.phase === "error" ? "alert" : "status"}
      >
        {ptt.error ?? ptt.readback ?? "Space works too"}
      </span>
    </div>
  );
}
