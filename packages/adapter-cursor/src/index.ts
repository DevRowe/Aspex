import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
} from "@aspex/schema";
import { CURSOR_SOURCE } from "./map";

export class CursorAdapter implements Adapter {
  id = CURSOR_SOURCE;

  async start(_ctx: AdapterContext): Promise<void> {}

  listActions(_itemId: string): Action[] {
    return [];
  }

  async runAction(
    _itemId: string,
    _actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    return { ok: false, message: "cursor is observe-only in Phase 3" };
  }

  async stop(): Promise<void> {}
}

export * from "./map";
export * from "./verify";
