import type { Action, Signal } from "./types";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface Adapter {
  id: string;
  start(ctx: AdapterContext): Promise<void>;
  listActions(itemId: string): Action[];
  runAction(
    itemId: string,
    actionId: string,
    payload?: unknown,
  ): Promise<ActionResult>;
  stop(): Promise<void>;
}

export interface AdapterContext {
  emit(signal: Signal): void;
  heartbeat(source: string): void;
  log(msg: string): void;
}
