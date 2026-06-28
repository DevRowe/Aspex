import type { VoiceResult, VoiceSession } from "@aspex/schema";
import { create } from "zustand";

export type VoicePhase =
  | "idle"
  | "listening"
  | "transcribing"
  | "result"
  | "error";

const ENABLED_KEY = "aspex.voice.enabled";

interface VoiceStore {
  phase: VoicePhase;
  lastReadback: string | null;
  lastOk: boolean | null;
  session: VoiceSession;
  error: string | null;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  setPhase: (phase: VoicePhase) => void;
  setError: (error: string) => void;
  clearError: () => void;
  applyResult: (result: VoiceResult) => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  phase: "idle",
  lastReadback: null,
  lastOk: null,
  session: {},
  error: null,
  enabled: readEnabled(),
  setEnabled: (enabled) => {
    writeEnabled(enabled);
    set({ enabled });
  },
  setPhase: (phase) => set({ phase, error: null }),
  setError: (error) => set({ phase: "error", error }),
  clearError: () => set({ error: null, phase: "idle" }),
  applyResult: (result) =>
    set({
      phase: "result",
      lastReadback: result.readback,
      lastOk: result.ok,
      session: result.session,
      error: null,
    }),
}));

function readEnabled(): boolean {
  const storage = getStorage();
  const value = storage?.getItem(ENABLED_KEY);
  return value === null || value === undefined ? true : value !== "false";
}

function writeEnabled(enabled: boolean): void {
  try {
    getStorage()?.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be unavailable in tests or locked-down browser contexts.
  }
}

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
