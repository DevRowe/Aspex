import { useEffect, useRef, useState } from "react";
import { useIntent } from "./useIntent";

export function IntentBar() {
  const [text, setText] = useState("");
  const { submitting, error, submitIntent } = useIntent();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || shouldSuppressFocusHotkey(event.target)) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submitIntent(text).then((result) => {
          if (result) {
            setText("");
          }
        });
      }}
    >
      <div className="flex min-h-11 items-center gap-2 rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:text-zinc-500"
          value={text}
          placeholder="Type intent"
          disabled={submitting}
          aria-label="Intent"
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
          disabled={submitting || text.trim() === ""}
        >
          {submitting ? "Sending" : "Send"}
        </button>
      </div>
      {error ? (
        <div className="rounded border border-red-900/70 bg-red-950/20 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}
    </form>
  );
}

function shouldSuppressFocusHotkey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
