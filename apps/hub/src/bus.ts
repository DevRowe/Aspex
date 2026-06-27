import { EventEmitter } from "node:events";
import type { AttentionItem } from "@aspex/schema";

export type HubEvents = {
  "world:changed": { upserted: AttentionItem[]; removed: string[] };
};

export class Bus {
  private emitter = new EventEmitter();

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
