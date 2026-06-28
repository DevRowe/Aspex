import type { PreviewEngineKind, PreviewSpec } from "@aspex/schema";

export interface ExitInfo {
  code: number | null;
  message: string;
}

export interface PreviewHandle {
  url: string;
  stop(): Promise<void>;
  /**
   * Register for engine process/container exit. Implementations must invoke
   * registered callbacks at most once for a handle.
   */
  onExit(cb: (info: ExitInfo) => void): void;
}

export interface PreviewEngine {
  kind: PreviewEngineKind;
  available(): Promise<boolean>;
  /**
   * Boot a declared Preview spec only. Real engines must bind the exposed
   * preview URL to 127.0.0.1, may pull declared images, and must never build.
   */
  boot(spec: PreviewSpec): Promise<PreviewHandle>;
  sweep?(): Promise<void>;
}
