import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
  Evidence,
  Severity,
  Signal,
  State,
} from "@aspex/schema";
import { webhookId } from "@aspex/schema";

export const WEBHOOK_SOURCE = "webhook" as const;

const STATES = [
  "working",
  "blocked",
  "needs_review",
  "done",
  "error",
] as const satisfies readonly State[];

const SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
] as const satisfies readonly Severity[];

export interface WebhookBody {
  key?: unknown;
  id?: unknown;
  summary?: unknown;
  state?: unknown;
  severity?: unknown;
  attentionRequired?: unknown;
  project?: unknown;
  evidence?: unknown;
}

export class WebhookAdapter implements Adapter {
  id = WEBHOOK_SOURCE;

  async start(_ctx: AdapterContext): Promise<void> {}

  listActions(_itemId: string): Action[] {
    return [];
  }

  async runAction(
    _itemId: string,
    _actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    return { ok: false, message: "read-only in Phase 0" };
  }

  async stop(): Promise<void> {}
}

export function normalizeWebhookBody(body: unknown): Signal {
  if (!isRecord(body)) {
    throw new Error("Invalid webhook body");
  }

  const summary = stringField(body.summary);

  if (summary === undefined) {
    throw new Error("Invalid webhook body");
  }

  const attentionRequired =
    typeof body.attentionRequired === "boolean"
      ? body.attentionRequired
      : false;

  return {
    id: signalIdFor(body),
    source: WEBHOOK_SOURCE,
    project: stringField(body.project) ?? WEBHOOK_SOURCE,
    state:
      stateField(body.state) ??
      (attentionRequired ? "needs_review" : "working"),
    attentionRequired,
    severity: severityField(body.severity) ?? "info",
    summary,
    evidence: evidenceField(body.evidence),
    actions: [],
  };
}

function signalIdFor(body: Record<string, unknown>): string {
  const key = stringField(body.key);

  if (key !== undefined) {
    return webhookId(key);
  }

  const id = stringField(body.id);

  if (id !== undefined && isWebhookId(id)) {
    return id;
  }

  throw new Error("Invalid webhook body");
}

function isWebhookId(id: string): boolean {
  const key = id.slice("webhook:".length);

  return id.startsWith("webhook:") && key.length > 0 && !key.startsWith(":");
}

function evidenceField(value: unknown): Evidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const label = stringField(entry.label);

    if (label === undefined) {
      return [];
    }

    return [
      {
        label,
        ...(stringField(entry.url) !== undefined
          ? { url: stringField(entry.url) }
          : {}),
        ...(stringField(entry.text) !== undefined
          ? { text: stringField(entry.text) }
          : {}),
      },
    ];
  });
}

function stateField(value: unknown): State | undefined {
  return includesString(STATES, value) ? value : undefined;
}

function severityField(value: unknown): Severity | undefined {
  return includesString(SEVERITIES, value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
