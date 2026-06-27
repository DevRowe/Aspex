import type { AttentionItem } from "@aspex/schema";

export type { AttentionItem };

export interface RankedState {
  needsMe: AttentionItem[];
  overflow: AttentionItem[];
  ambient: AttentionItem[];
  generatedAt: string;
}
