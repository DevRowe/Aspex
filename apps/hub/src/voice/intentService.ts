import type {
  ClientDirective,
  Intent,
  IntentRequest,
  IntentResult,
  ItemId,
} from "@aspex/schema";
import { buildIntentSchema } from "./intentSchema";

export interface IntentService {
  resolve(req: IntentRequest): Promise<IntentResult>;
}

export interface HttpIntentConfig {
  endpoints: string[];
  model: string;
  timeoutMs: number;
}

export class OllamaIntentService implements IntentService {
  constructor(private cfg: HttpIntentConfig) {}

  async resolve(req: IntentRequest): Promise<IntentResult> {
    const selectedActions = actionsForSelectedItem(req);
    const schema = buildIntentSchema({
      needsMeIds: req.context.needsMeIds,
      selectedId: req.context.selectedId,
      selectedActions,
    });
    const prompt = buildPrompt(req);

    for (const endpoint of this.cfg.endpoints) {
      try {
        const response = await fetchWithTimeout(
          chatUrl(endpoint),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: this.cfg.model,
              stream: false,
              messages: [{ role: "user", content: prompt }],
              format: schema,
            }),
          },
          this.cfg.timeoutMs,
        );

        if (!response.ok) {
          continue;
        }

        const body = await response.json();
        const content = responseContent(body);
        if (content === undefined) {
          continue;
        }

        const parsed = JSON.parse(content) as unknown;
        const intent = validateIntent(parsed, req, selectedActions);
        if (intent !== undefined) {
          return { intent, source: "freeform" };
        }
      } catch {}
    }

    return { intent: noMatch(req.text), source: "freeform" };
  }
}

export class MockIntentService implements IntentService {
  private script: Intent[];

  constructor(script: Intent[] = []) {
    this.script = [...script];
  }

  async resolve(req: IntentRequest): Promise<IntentResult> {
    return {
      intent: this.script.shift() ?? noMatch(req.text),
      source: "freeform",
    };
  }
}

function noMatch(text: string): Intent {
  return { kind: "no_match", heard: text, reason: "unknown_command" };
}

function actionsForSelectedItem(req: IntentRequest): string[] {
  const selectedId = req.context.selectedId;
  if (selectedId === undefined) {
    return [];
  }

  return (
    req.candidates.find((candidate) => candidate.itemId === selectedId)
      ?.actions ?? []
  );
}

function buildPrompt(req: IntentRequest): string {
  return [
    "Map the user's command to exactly one first-stage Aspex Intent.",
    "Use only the JSON Schema. Return JSON only.",
    "If the command is compound, unsafe to infer, or does not match a live item/action, return no_match.",
    "",
    `User text: ${req.text}`,
    "",
    "Live candidates:",
    JSON.stringify(
      req.candidates.map((candidate) => ({
        itemId: candidate.itemId,
        summary: candidate.summary,
        actions: candidate.actions,
      })),
    ),
  ].join("\n");
}

function chatUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/api/chat`;
}

function responseContent(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.message)) {
    return undefined;
  }

  return typeof value.message.content === "string"
    ? value.message.content
    : undefined;
}

function validateIntent(
  value: unknown,
  req: IntentRequest,
  selectedActions: string[],
): Intent | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  const allowedIds = liveCandidateIds(req);
  const allowedActions = new Set(selectedActions);

  switch (value.kind) {
    case "action":
      if (
        typeof value.itemId === "string" &&
        typeof value.actionId === "string" &&
        allowedIds.has(value.itemId) &&
        allowedActions.has(value.actionId)
      ) {
        return {
          kind: "action",
          itemId: value.itemId,
          actionId: value.actionId,
        };
      }
      return undefined;

    case "dictate":
      if (
        typeof value.itemId === "string" &&
        typeof value.actionId === "string" &&
        allowedIds.has(value.itemId) &&
        allowedActions.has(value.actionId) &&
        (value.actionId === "comment" || value.actionId === "request_changes")
      ) {
        return {
          kind: "dictate",
          itemId: value.itemId,
          actionId: value.actionId,
        };
      }
      return undefined;

    case "read":
    case "open":
      if (typeof value.target === "string" && allowedIds.has(value.target)) {
        return { kind: value.kind, target: value.target };
      }
      return undefined;

    case "nav": {
      const directive = validateDirective(value.directive, allowedIds);
      return directive === undefined ? undefined : { kind: "nav", directive };
    }

    case "no_match":
      return value.reason === "unknown_command" ? noMatch(req.text) : undefined;

    case "confirm":
    case "dictation_body":
    case "post":
    case "cancel":
      return undefined;

    default:
      return undefined;
  }
}

function validateDirective(
  value: unknown,
  allowedIds: Set<string>,
): ClientDirective | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  switch (value.type) {
    case "show_needs_me":
      return { type: "show_needs_me" };
    case "move":
      return value.delta === 1 || value.delta === -1
        ? { type: "move", delta: value.delta }
        : undefined;
    case "select":
      return typeof value.id === "string" && allowedIds.has(value.id)
        ? { type: "select", id: value.id }
        : undefined;
    default:
      return undefined;
  }
}

function liveCandidateIds(req: IntentRequest): Set<ItemId> {
  const liveIds = new Set([
    ...(req.context.selectedId === undefined ? [] : [req.context.selectedId]),
    ...req.context.needsMeIds,
  ]);
  return new Set(
    req.candidates
      .map((candidate) => candidate.itemId)
      .filter((itemId) => liveIds.has(itemId)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Intent request timed out", "AbortError"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
