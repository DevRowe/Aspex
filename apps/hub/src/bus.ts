import { EventEmitter } from "node:events";
import type { AttentionItem } from "@aspex/schema";

export type HubEvents = {
  "world:changed": { upserted: AttentionItem[]; removed: string[] };
};

export class Bus {
  private emitter = new EventEmitter();

  constructor() {
    // The shared SSE frame source keeps world:changed at one listener, but
    // ad-hoc subscribers (ntfy, tests) should never trip the default cap of 10.
    this.emitter.setMaxListeners(0);
  }

  on<K extends keyof HubEvents>(k: K, fn: (e: HubEvents[K]) => void): void {
    this.emitter.on(k, fn);
  }

  off<K extends keyof HubEvents>(k: K, fn: (e: HubEvents[K]) => void): void {
    this.emitter.off(k, fn);
  }

  emit<K extends keyof HubEvents>(k: K, e: HubEvents[K]): void {
    this.emitter.emit(k, e);
  }
}
