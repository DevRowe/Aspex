import { create } from "zustand";
import type { RankedState } from "./types";

interface Store extends RankedState {
  connected: boolean;
  setState: (state: RankedState) => void;
  setConnected: (connected: boolean) => void;
}

export const useStore = create<Store>((set) => ({
  needsMe: [],
  overflow: [],
  ambient: [],
  generatedAt: "",
  connected: false,
  setState: (state) => set(state),
  setConnected: (connected) => set({ connected }),
}));
