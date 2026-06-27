import { useRef, useState } from "react";
import { runAction } from "../lib/hubClient";
import type { Action, ActionResult } from "../types";

interface ConfirmGateProps {
  itemId: string;
  action: Action;
  onResult: (result: ActionResult) => void;
}

export function ConfirmGate({ itemId, action, onResult }: ConfirmGateProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const confirmWord = action.label;
  const canSubmit = typed === confirmWord && !pending;

  const submit = async () => {
    if (!canSubmit || pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      onResult(await runAction(itemId, action.id, true));
      setOpen(false);
      setTyped("");
    } catch (error) {
      onResult({
        ok: false,
        message: error instanceof Error ? error.message : "Action failed",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="rounded border border-red-800 px-3 py-2 text-sm font-medium text-red-100 hover:border-red-600"
        onClick={() => setOpen(true)}
      >
        {action.label}
      </button>
    );
  }

  return (
    <div className="rounded border border-red-800/80 bg-red-950/20 p-3">
      <p className="break-words text-sm text-red-100">
        Type <span className="font-semibold">{confirmWord}</span> to confirm.
      </p>
      <input
        className="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-red-600"
        value={typed}
        disabled={pending}
        placeholder={confirmWord}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-red-700 px-3 py-2 text-sm font-medium text-red-100 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {pending ? "Running..." : "Confirm"}
        </button>
        <button
          type="button"
          className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
