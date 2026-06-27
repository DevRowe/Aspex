import { create } from "zustand";
import type { RankedState } from "./types";

interface Store extends RankedState {
  connected: boolean;
  selectedId: string | null;
  setState: (state: RankedState) => void;
  setConnected: (connected: boolean) => void;
  setSelectedId: (selectedId: string | null) => void;
}

export const useStore = create<Store>((set) => ({
  needsMe: [],
  overflow: [],
  ambient: [],
  generatedAt: "",
  connected: false,
  selectedId: null,
  setState: (state) => set(state),
  setConnected: (connected) => set({ connected }),
  setSelectedId: (selectedId) => set({ selectedId }),
}));
