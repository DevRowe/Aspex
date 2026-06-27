import { useState } from "react";
import type { ActionResult, AttentionItem } from "../types";
import { ActionButton } from "./ActionButton";
import { ConfirmGate } from "./ConfirmGate";

interface ItemDetailProps {
  item: AttentionItem;
}

export function ItemDetail({ item }: ItemDetailProps) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const isClaudeCodeReadOnly = item.source === "claude-code";
  const hasExecutableActions = item.actions.length > 0 && !isClaudeCodeReadOnly;

  return (
    <aside className="rounded border border-zinc-800 bg-zinc-900/70 p-4 lg:sticky lg:top-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Item detail
          </p>
          <h2 className="mt-2 break-words text-lg font-semibold leading-7 text-zinc-50">
            {item.summary}
          </h2>
        </div>
        <span className="rounded border border-zinc-800 px-2 py-1 text-xs leading-none text-zinc-400">
          {item.source}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm text-zinc-400 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-600">
            Project
          </dt>
          <dd className="mt-1 break-words text-zinc-200">{item.project}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-600">
            State
          </dt>
          <dd className="mt-1 break-words text-zinc-200">{item.state}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-600">
            Reason
          </dt>
          <dd className="mt-1 break-words text-zinc-200">{item.reason}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-600">
            Severity
          </dt>
          <dd className="mt-1 break-words text-zinc-200">{item.severity}</dd>
        </div>
        {item.actor ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-600">
              Actor
            </dt>
            <dd className="mt-1 break-words text-zinc-200">{item.actor}</dd>
          </div>
        ) : null}
        {item.session ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-600">
              Session
            </dt>
            <dd className="mt-1 break-words text-zinc-200">{item.session}</dd>
          </div>
        ) : null}
      </dl>

      <section className="mt-5 border-t border-zinc-800 pt-4">
        <h3 className="text-sm font-semibold text-zinc-200">Evidence</h3>
        {item.evidence.length > 0 ? (
          <ul className="mt-3 grid gap-3">
            {item.evidence.map((evidence) => (
              <li
                key={`${evidence.label}-${evidence.url ?? evidence.text ?? ""}`}
                className="rounded border border-zinc-800 bg-zinc-950/40 p-3"
              >
                <div className="break-words text-sm font-medium text-zinc-200">
                  {evidence.url ? (
                    <a
                      className="underline decoration-zinc-600 underline-offset-4 hover:text-zinc-50"
                      href={evidence.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {evidence.label}
                    </a>
                  ) : (
                    evidence.label
                  )}
                </div>
                {evidence.text ? (
                  <p className="mt-2 break-words text-sm leading-6 text-zinc-400">
                    {evidence.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-500">
            No evidence attached.
          </p>
        )}
      </section>

      {item.deepLink ? (
        <section className="mt-5 border-t border-zinc-800 pt-4">
          <h3 className="text-sm font-semibold text-zinc-200">Links</h3>
          <a
            className="mt-3 inline-flex max-w-full rounded border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 hover:border-zinc-500"
            href={item.deepLink}
            target="_blank"
            rel="noreferrer"
          >
            <span className="truncate">
              {item.source === "claude-code" ? "Focus terminal" : "Open"}
            </span>
          </a>
        </section>
      ) : null}

      <section className="mt-5 border-t border-zinc-800 pt-4">
        <h3 className="text-sm font-semibold text-zinc-200">Actions</h3>
        {hasExecutableActions ? (
          <div className="mt-3 grid gap-3">
            {item.actions.map((action) =>
              action.risk === "dangerous" ||
              (action.requiresConfirmation && action.risk !== "medium") ? (
                <ConfirmGate
                  key={action.id}
                  itemId={item.id}
                  action={action}
                  onResult={setResult}
                />
              ) : (
                <ActionButton
                  key={action.id}
                  itemId={item.id}
                  action={action}
                  onResult={setResult}
                />
              ),
            )}
          </div>
        ) : (
          <p className="mt-3 rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-500">
            No actions available.
          </p>
        )}

        {result ? (
          <p
            className={[
              "mt-4 break-words rounded border p-3 text-sm",
              result.ok
                ? "border-emerald-800/70 bg-emerald-950/20 text-emerald-100"
                : "border-red-800/70 bg-red-950/20 text-red-100",
            ].join(" ")}
            aria-live="polite"
          >
            {result.message ??
              (result.ok ? "Action accepted" : "Action failed")}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
