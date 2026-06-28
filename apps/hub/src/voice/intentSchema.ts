import type { ItemId } from "@aspex/schema";

export type JsonSchema = Record<string, unknown>;

export interface SchemaInput {
  needsMeIds: ItemId[];
  selectedId?: ItemId;
  selectedActions: string[];
}

type Branch = Record<string, unknown>;

const DICTATION_ACTIONS = ["comment", "request_changes"] as const;

export function buildIntentSchema(input: SchemaInput): JsonSchema {
  const ids = dedupe([
    ...(input.selectedId === undefined ? [] : [input.selectedId]),
    ...input.needsMeIds,
  ]);
  const actions = dedupe(input.selectedActions);
  const dictationActions = actions.filter((action) =>
    DICTATION_ACTIONS.includes(action as (typeof DICTATION_ACTIONS)[number]),
  );

  const branches: Branch[] = [];

  if (ids.length > 0 && actions.length > 0) {
    branches.push(actionBranch(ids, actions));
  }

  if (ids.length > 0 && dictationActions.length > 0) {
    branches.push(dictateBranch(ids, dictationActions));
  }

  branches.push(navBranch(ids));

  if (ids.length > 0) {
    branches.push(readOrOpenBranch("read", ids));
    branches.push(readOrOpenBranch("open", ids));
  }

  branches.push(noMatchBranch());

  return {
    type: "object",
    oneOf: branches,
  };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function actionBranch(ids: ItemId[], actions: string[]): Branch {
  return {
    type: "object",
    properties: {
      kind: { const: "action" },
      itemId: { enum: ids },
      actionId: { enum: actions },
    },
    required: ["kind", "itemId", "actionId"],
    additionalProperties: false,
  };
}

function dictateBranch(ids: ItemId[], actions: string[]): Branch {
  return {
    type: "object",
    properties: {
      kind: { const: "dictate" },
      itemId: { enum: ids },
      actionId: { enum: actions },
    },
    required: ["kind", "itemId", "actionId"],
    additionalProperties: false,
  };
}

function navBranch(ids: ItemId[]): Branch {
  const directives: Branch[] = [
    {
      type: "object",
      properties: {
        type: { const: "show_needs_me" },
      },
      required: ["type"],
      additionalProperties: false,
    },
  ];

  if (ids.length > 0) {
    directives.push({
      type: "object",
      properties: {
        type: { const: "move" },
        delta: { enum: [1, -1] },
      },
      required: ["type", "delta"],
      additionalProperties: false,
    });
    directives.push({
      type: "object",
      properties: {
        type: { const: "select" },
        id: { enum: ids },
      },
      required: ["type", "id"],
      additionalProperties: false,
    });
  }

  return {
    type: "object",
    properties: {
      kind: { const: "nav" },
      directive: { oneOf: directives },
    },
    required: ["kind", "directive"],
    additionalProperties: false,
  };
}

function readOrOpenBranch(kind: "read" | "open", ids: ItemId[]): Branch {
  return {
    type: "object",
    properties: {
      kind: { const: kind },
      target: { enum: ids },
    },
    required: ["kind", "target"],
    additionalProperties: false,
  };
}

function noMatchBranch(): Branch {
  return {
    type: "object",
    properties: {
      kind: { const: "no_match" },
      heard: { const: "" },
      reason: { const: "unknown_command" },
    },
    required: ["kind", "heard", "reason"],
    additionalProperties: false,
  };
}
