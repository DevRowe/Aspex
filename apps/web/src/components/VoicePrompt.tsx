import type { VoiceSession } from "@aspex/schema";

interface VoicePromptProps {
  session: VoiceSession;
}

export function VoicePrompt({ session }: VoicePromptProps) {
  if (session.pendingConfirm) {
    return (
      <div className="rounded border border-amber-900/70 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
        Say "confirm {confirmPhrase(session.pendingConfirm.actionId)}"
      </div>
    );
  }

  if (session.dictating) {
    return (
      <div className="grid gap-2 rounded border border-sky-900/70 bg-sky-950/20 px-3 py-2 text-sm text-sky-100">
        <div>
          Dictating {dictationLabel(session.dictating.actionId)}. Say "post it"
          when ready.
        </div>
        {session.dictating.pendingBody ? (
          <div className="break-words border-t border-sky-900/70 pt-2 text-sky-50">
            {session.dictating.pendingBody}
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

function dictationLabel(actionId: string): string {
  return actionId === "request_changes" ? "changes" : actionId;
}

function confirmPhrase(actionId: string): string {
  return actionId.replaceAll("_", " ");
}
