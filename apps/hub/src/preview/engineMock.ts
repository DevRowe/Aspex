import type { PreviewSpec } from "@aspex/schema";
import type { ExitInfo, PreviewEngine, PreviewHandle } from "./engine";

export interface MockEngineOptions {
  port?: number;
  failBoot?: boolean;
}

export type MockPreviewEngine = PreviewEngine & {
  simulateExit(message: string): void;
};

interface MockHandleRecord {
  callbacks: Set<(info: ExitInfo) => void>;
  exited: boolean;
  stopped: boolean;
}

export function createMockEngine(
  opts: MockEngineOptions = {},
): MockPreviewEngine {
  const port = opts.port ?? 41999;
  const handles: MockHandleRecord[] = [];

  return {
    kind: "mock",

    async available(): Promise<boolean> {
      return true;
    },

    async boot(_spec: PreviewSpec): Promise<PreviewHandle> {
      if (opts.failBoot === true) {
        throw new Error("Mock preview engine failed to boot");
      }

      const record: MockHandleRecord = {
        callbacks: new Set(),
        exited: false,
        stopped: false,
      };
      handles.push(record);

      return {
        url: `http://127.0.0.1:${port}`,

        async stop(): Promise<void> {
          record.stopped = true;
          record.callbacks.clear();
        },

        onExit(cb: (info: ExitInfo) => void): void {
          if (record.stopped || record.exited) {
            return;
          }
          record.callbacks.add(cb);
        },
      };
    },

    simulateExit(message: string): void {
      let record: MockHandleRecord | undefined;
      for (let index = handles.length - 1; index >= 0; index -= 1) {
        const candidate = handles[index];
        if (candidate === undefined) {
          continue;
        }
        if (!candidate.stopped && !candidate.exited) {
          record = candidate;
          break;
        }
      }

      if (record === undefined) {
        return;
      }

      record.exited = true;
      const info: ExitInfo = { code: null, message };
      const callbacks = [...record.callbacks];
      record.callbacks.clear();
      for (const cb of callbacks) {
        cb(info);
      }
    },
  };
}
