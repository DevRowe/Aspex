import type {
  Action,
  Intent,
  ItemId,
  MergeWord,
  Transcript,
  VoiceContext,
  VoiceSession,
} from "@aspex/schema";

export interface ParseInput {
  transcript: Transcript;
  context: VoiceContext;
  session: VoiceSession;
  selectedActions: Action[];
  resolveProject: (name: string) => ItemId | "ambiguous" | null;
  confidenceThreshold: number;
  intentId?: string;
}

type ActionIntentKind = "action" | "dictate";

interface Verb {
  actionId: string;
  kind: ActionIntentKind;
  phrases: readonly string[];
}

const VERBS: readonly Verb[] = [
  { actionId: "approve", kind: "action", phrases: ["approve"] },
  { actionId: "deny", kind: "dictate", phrases: ["deny"] },
  { actionId: "answer", kind: "dictate", phrases: ["answer"] },
  { actionId: "redirect", kind: "dictate", phrases: ["redirect"] },
  { actionId: "ship", kind: "action", phrases: ["ship", "review and ship"] },
  { actionId: "rerun", kind: "action", phrases: ["re-run", "re-run checks"] },
  { actionId: "merge", kind: "action", phrases: ["merge"] },
  { actionId: "comment", kind: "dictate", phrases: ["comment"] },
  {
    actionId: "request_changes",
    kind: "dictate",
    phrases: ["request changes", "reject"],
  },
];

const ACTION_BY_PHRASE = new Map(
  VERBS.flatMap((verb) => verb.phrases.map((phrase) => [phrase, verb])),
);

export function parse(input: ParseInput): Intent {
  const normalized = normalize(input.transcript.text);

  if (input.transcript.confidence < input.confidenceThreshold) {
    return noMatch(input.transcript.text, "low_confidence");
  }

  if (input.session.dictating !== undefined) {
    if (normalized === "post it" || normalized === "send it") {
      return { kind: "post" };
    }

    if (normalized === "cancel" || normalized === "never mind") {
      return { kind: "cancel" };
    }

    return { kind: "dictation_body", text: input.transcript.text };
  }

  if (normalized === "cancel" || normalized === "never mind") {
    return { kind: "cancel" };
  }

  if (
    normalized === "confirm dispatch" &&
    input.session.pendingDispatch !== undefined
  ) {
    return {
      kind: "confirm_dispatch",
      intentId: input.session.pendingDispatch.intentId,
    };
  }

  const pendingConfirm = input.session.pendingConfirm;
  if (pendingConfirm !== undefined) {
    const mergeWord = mergeWordForConfirmation(normalized);
    if (pendingConfirm.actionId === "ship" && mergeWord !== undefined) {
      return {
        kind: "confirm",
        itemId: pendingConfirm.itemId,
        actionId: pendingConfirm.actionId,
        mergeWord,
      };
    }

    const confirmMatch = /^confirm (.+)$/.exec(normalized);
    const confirmVerb = confirmMatch?.[1];
    if (
      confirmVerb !== undefined &&
      pendingConfirm.actionId !== "ship" &&
      actionIdForConfirmVerb(confirmVerb) === pendingConfirm.actionId
    ) {
      return {
        kind: "confirm",
        itemId: pendingConfirm.itemId,
        actionId: pendingConfirm.actionId,
      };
    }
  }

  if (normalized === "what needs me" || normalized === "show what needs me") {
    return { kind: "nav", directive: { type: "show_needs_me" } };
  }

  if (normalized === "status" || normalized === "status query") {
    return {
      kind: "status_query",
      ...(input.intentId ? { intentId: input.intentId } : {}),
    };
  }

  if (normalized.startsWith("dispatch ")) {
    const instruction = input.transcript.text
      .trim()
      .replace(/^dispatch\s+/i, "")
      .trim();
    if (instruction === "") {
      return noMatch(input.transcript.text, "unknown_command");
    }
    return {
      kind: "dispatch_task",
      instruction,
      orchestrator: "giles",
      ...(input.intentId ? { intentId: input.intentId } : {}),
    };
  }

  if (normalized === "next") {
    return { kind: "nav", directive: { type: "move", delta: 1 } };
  }

  if (normalized === "previous") {
    return { kind: "nav", directive: { type: "move", delta: -1 } };
  }

  if (normalized.startsWith("focus ")) {
    const projectName = normalized.slice("focus ".length).trim();
    if (projectName === "") {
      return noMatch(input.transcript.text, "no_referent");
    }

    const projectId = input.resolveProject(projectName);
    if (projectId === "ambiguous") {
      return noMatch(input.transcript.text, "ambiguous");
    }
    if (projectId === null) {
      return noMatch(input.transcript.text, "no_referent");
    }

    return { kind: "nav", directive: { type: "select", id: projectId } };
  }

  if (normalized === "read it" || normalized === "read this") {
    if (input.context.selectedId === undefined) {
      return noMatch(input.transcript.text, "no_referent");
    }

    return { kind: "read", target: input.context.selectedId };
  }

  if (normalized === "open it" || normalized === "open this") {
    if (input.context.selectedId === undefined) {
      return noMatch(input.transcript.text, "no_referent");
    }

    return { kind: "open", target: input.context.selectedId };
  }

  const verb = ACTION_BY_PHRASE.get(normalized);
  if (verb !== undefined) {
    if (input.context.selectedId === undefined) {
      return noMatch(input.transcript.text, "no_referent");
    }

    if (!input.selectedActions.some((action) => action.id === verb.actionId)) {
      return noMatch(input.transcript.text, "action_unavailable");
    }

    if (verb.kind === "dictate") {
      return {
        kind: "dictate",
        itemId: input.context.selectedId,
        actionId: verb.actionId,
        ...(input.intentId ? { intentId: input.intentId } : {}),
      };
    }

    return {
      kind: "action",
      itemId: input.context.selectedId,
      actionId: verb.actionId,
      ...(input.intentId ? { intentId: input.intentId } : {}),
    };
  }

  return noMatch(input.transcript.text, "unknown_command");
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

function actionIdForConfirmVerb(verb: string): string | undefined {
  return ACTION_BY_PHRASE.get(verb)?.actionId;
}

function mergeWordForConfirmation(text: string): MergeWord | undefined {
  if (text === "merge" || text === "confirm merge") {
    return "merge";
  }
  if (text === "ship" || text === "confirm ship") {
    return "ship";
  }
  return undefined;
}

function noMatch(
  heard: string,
  reason: Extract<Intent, { kind: "no_match" }>["reason"],
): Intent {
  return { kind: "no_match", heard, reason };
}
