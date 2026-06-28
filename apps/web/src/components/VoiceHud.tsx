import type { VoicePhase } from "../voice/voiceStore";

interface VoiceHudProps {
  enabled: boolean;
  phase: VoicePhase;
  lastReadback: string | null;
  lastOk: boolean | null;
  error: string | null;
}

const phaseCopy: Record<VoicePhase, string> = {
  idle: "Voice ready",
  listening: "Listening",
  transcribing: "Transcribing",
  result: "Read-back",
  error: "Voice needs attention",
};

export function VoiceHud({
  enabled,
  phase,
  lastReadback,
  lastOk,
  error,
}: VoiceHudProps) {
  const message = !enabled
    ? "Voice off"
    : error
      ? permissionHelp(error)
      : (lastReadback ?? phaseCopy[phase]);
  const tone = !enabled
    ? "border-zinc-800 bg-zinc-950/50 text-zinc-500"
    : phase === "error"
      ? "border-red-900/70 bg-red-950/20 text-red-100"
      : lastOk === false
        ? "border-amber-900/70 bg-amber-950/20 text-amber-100"
        : "border-zinc-800 bg-zinc-900/70 text-zinc-200";

  return (
    <div
      className={`flex min-h-11 max-w-full items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${tone}`}
      role={phase === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {!enabled ? "Off" : phaseCopy[phase]}
      </span>
      <span className="min-w-0 flex-1 truncate text-right">{message}</span>
    </div>
  );
}

function permissionHelp(error: string): string {
  if (!/permission|notallowed/i.test(error)) {
    return error;
  }

  return `${error} Allow microphone access for this browser or the Tauri app, then try again.`;
}
