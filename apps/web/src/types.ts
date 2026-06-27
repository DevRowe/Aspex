import type { Action, ActionResult, AttentionItem } from "@aspex/schema";

export type { Action, ActionResult, AttentionItem };

export interface RankedState {
  needsMe: AttentionItem[];
  overflow: AttentionItem[];
  ambient: AttentionItem[];
  generatedAt: string;
}
