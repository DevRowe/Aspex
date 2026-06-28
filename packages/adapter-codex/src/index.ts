import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
} from "@aspex/schema";

export const CODEX_SOURCE = "codex" as const;

export class CodexAdapter implements Adapter {
  id = CODEX_SOURCE;

  async start(_ctx: AdapterContext): Promise<void> {}

  listActions(_itemId: string): Action[] {
    return [];
  }

  async runAction(
    _itemId: string,
    _actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    return { ok: false, message: "codex is observe-only in Phase 3" };
  }

  async stop(): Promise<void> {}
}

export * from "./map";
export * from "./notify-install";
