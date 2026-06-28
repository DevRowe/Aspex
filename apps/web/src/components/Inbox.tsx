import type { VoiceResult } from "@aspex/schema";
import { useCallback, useState } from "react";
import { Deck } from "../preview/Deck";
import { usePreviewStore } from "../preview/usePreviews";
import { useStore } from "../store";
import { applyDirective } from "../voice/applyDirective";
import type { PushToTalkPhase } from "../voice/usePushToTalk";
import { useVoiceStore } from "../voice/voiceStore";
import { AmbientList } from "./AmbientList";
import { ItemCard } from "./ItemCard";
import { ItemDetail } from "./ItemDetail";
import { PttButton } from "./PttButton";
import { VoiceHud } from "./VoiceHud";
import { VoicePrompt } from "./VoicePrompt";

export function Inbox() {
  const needsMe = useStore((state) => state.needsMe);
  const overflow = useStore((state) => state.overflow);
  const ambient = useStore((state) => state.ambient);
  const connected = useStore((state) => state.connected);
  const selectedId = useStore((state) => state.selectedId);
  const voiceEnabled = useVoiceStore((state) => state.enabled);
  const setVoiceEnabled = useVoiceStore((state) => state.setEnabled);
  const voicePhase = useVoiceStore((state) => state.phase);
  const voiceLastReadback = useVoiceStore((state) => state.lastReadback);
  const voiceLastOk = useVoiceStore((state) => state.lastOk);
  const voiceSession = useVoiceStore((state) => state.session);
  const voiceError = useVoiceStore((state) => state.error);
  const previewsEnabled = usePreviewStore((state) => state.enabled);
  const [showOverflow, setShowOverflow] = useState(false);
  const visibleNeedsMe = showOverflow ? [...needsMe, ...overflow] : needsMe;
  const selectedItem =
    [...needsMe, ...overflow, ...ambient].find(
      (item) => item.id === selectedId,
    ) ?? null;
  const onVoiceResult = useCallback((result: VoiceResult) => {
    useVoiceStore.getState().applyResult(result);
    applyDirective(result.directive);
  }, []);
  const onVoicePhaseChange = useCallback((phase: PushToTalkPhase) => {
    const store = useVoiceStore.getState();

    if (phase === "listening") {
      store.setPhase("listening");
      return;
    }

    if (phase === "sending") {
      store.setPhase("transcribing");
      return;
    }

    if (phase === "error") {
      return;
    }

    if (store.phase === "listening" || store.phase === "transcribing") {
      store.setPhase("idle");
    }
  }, []);
  const onVoiceError = useCallback((error: string | undefined) => {
    if (error) {
      useVoiceStore.getState().setError(error);
    }
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold leading-tight text-zinc-50 sm:text-3xl">
              What needs me
            </h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <input
                type="checkbox"
                className="size-4 accent-emerald-400"
                checked={voiceEnabled}
                onChange={(event) => setVoiceEnabled(event.target.checked)}
              />
              Voice
            </label>
            <PttButton
              enabled={voiceEnabled}
              onResult={onVoiceResult}
              onPhaseChange={onVoicePhaseChange}
              onError={onVoiceError}
            />
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
          </div>
        </header>

        <div className="grid gap-2">
          <VoiceHud
            enabled={voiceEnabled}
            phase={voicePhase}
            lastReadback={voiceLastReadback}
            lastOk={voiceLastOk}
            error={voiceError}
          />
          <VoicePrompt session={voiceSession} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start">
          <div className="grid gap-8">
            <section
              className="grid gap-3 focus:outline-none"
              aria-label="Needs me"
              data-voice-section="needs-me"
              tabIndex={-1}
            >
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

            {previewsEnabled ? <Deck /> : null}

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
