import type {
  Action,
  Intent,
  ItemId,
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
}

type ActionIntentKind = "action" | "dictate";

interface Verb {
  actionId: "approve" | "rerun" | "merge" | "comment" | "request_changes";
  kind: ActionIntentKind;
  phrases: readonly string[];
}

const VERBS: readonly Verb[] = [
  { actionId: "approve", kind: "action", phrases: ["approve"] },
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

  const confirmMatch = /^confirm (.+)$/.exec(normalized);
  const confirmVerb = confirmMatch?.[1];
  if (
    confirmVerb !== undefined &&
    input.session.pendingConfirm !== undefined &&
    actionIdForConfirmVerb(confirmVerb) ===
      input.session.pendingConfirm.actionId
  ) {
    return {
      kind: "confirm",
      itemId: input.session.pendingConfirm.itemId,
      actionId: input.session.pendingConfirm.actionId,
    };
  }

  if (normalized === "what needs me" || normalized === "show what needs me") {
    return { kind: "nav", directive: { type: "show_needs_me" } };
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
      };
    }

    return {
      kind: "action",
      itemId: input.context.selectedId,
      actionId: verb.actionId,
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

function noMatch(
  heard: string,
  reason: Extract<Intent, { kind: "no_match" }>["reason"],
): Intent {
  return { kind: "no_match", heard, reason };
}
