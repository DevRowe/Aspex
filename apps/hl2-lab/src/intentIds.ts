export interface IntentIdSource {
  now(): number;
  uuid(): string;
}

const defaultSource: IntentIdSource = {
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
};

export function createIntentId(
  verb: string,
  source: IntentIdSource = defaultSource,
): string {
  const safeVerb =
    verb
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .slice(0, 24) || "intent";
  const uuid = source.uuid().replace(/[^A-Za-z0-9._-]/g, "");
  return `hl2-${source.now().toString(36)}-${safeVerb}-${uuid}`.slice(0, 128);
}

export interface LogicalAction {
  intentId: string;
  itemId: string;
  actionId: string;
  payload?: Record<string, unknown>;
}

export interface LogicalDispatch {
  intentId: string;
  orchestrator: string;
  instruction: string;
  project?: string;
}
