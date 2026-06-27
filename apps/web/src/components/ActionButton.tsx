import { useRef, useState } from "react";
import { runAction } from "../lib/hubClient";
import type { Action, ActionResult } from "../types";

interface ActionButtonProps {
  itemId: string;
  action: Action;
  onResult: (result: ActionResult) => void;
}

export function ActionButton({ itemId, action, onResult }: ActionButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const submit = async () => {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      onResult(await runAction(itemId, action.id, action.risk === "medium"));
      setConfirming(false);
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

  if (action.risk === "medium" && confirming) {
    return (
      <div className="rounded border border-amber-700/60 bg-amber-950/20 p-3">
        <p className="break-words text-sm text-amber-100">
          Confirm {action.label}?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-amber-600 px-3 py-2 text-sm font-medium text-amber-100 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "Running..." : "Confirm"}
          </button>
          <button
            type="button"
            className="rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="rounded border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      onClick={() => {
        if (action.risk === "medium") {
          setConfirming(true);
          return;
        }

        void submit();
      }}
    >
      {pending ? "Running..." : action.label}
    </button>
  );
}
