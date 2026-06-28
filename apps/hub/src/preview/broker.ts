import type { Preview, PreviewSpec } from "@aspex/schema";
import type { PreviewEngine, PreviewHandle } from "./engine";

export interface BrokerConfig {
  maxConcurrent: number;
  defaultIdleTtlSec: number;
}

export interface PreviewBroker {
  boot(specId: string): Promise<Preview>;
  stop(previewId: string): Promise<void>;
  get(previewId: string): Preview | undefined;
  list(): Preview[];
  /** Reap previews past their idle TTL. Driven by a periodic ticker (boot.ts) so
   *  an idle Hub auto-reaps; also runs lazily on boot/get/list. */
  sweep(): Promise<void>;
  shutdown(): Promise<void>;
  onChange(cb: (p: Preview) => void): () => void;
}

export function createPreviewBroker(args: {
  engine: PreviewEngine;
  lookupSpec: (specId: string) => PreviewSpec | undefined;
  config: BrokerConfig;
  now?: () => number;
}): PreviewBroker {
  const now = args.now ?? Date.now;
  const records = new Map<string, PreviewRecord>();
  const inFlightBoots = new Set<Promise<void>>();
  const listeners = new Set<(p: Preview) => void>();
  let nextPreviewId = 1;
  let shuttingDown = false;

  const broker: PreviewBroker = {
    async boot(specId: string): Promise<Preview> {
      await sweepExpired();

      if (shuttingDown) {
        throw new Error("Preview broker is shutting down");
      }

      const spec = args.lookupSpec(specId);
      if (spec === undefined) {
        throw new Error(`Unknown Preview spec: ${specId}`);
      }

      if (spec.trust !== "trusted") {
        throw new Error(
          "Untrusted Preview spec: pixels lane not yet available",
        );
      }

      if (activeCount() >= args.config.maxConcurrent) {
        throw new Error("too many previews open");
      }

      const previewId = `preview-${nextPreviewId.toString(36)}`;
      nextPreviewId += 1;

      createRecord({
        previewId,
        specId: spec.id,
        state: "booting",
        trust: spec.trust,
        startedAt: isoNow(),
      });

      const bootTask = finishBoot(previewId, spec).finally(() => {
        inFlightBoots.delete(bootTask);
      });
      inFlightBoots.add(bootTask);

      return copyPreview(requiredRecord(previewId).preview);
    },

    async stop(previewId: string): Promise<void> {
      await stopPreview(previewId);
    },

    async sweep(): Promise<void> {
      await sweepExpired();
    },

    get(previewId: string): Preview | undefined {
      void sweepExpired();
      const record = records.get(previewId);
      return record === undefined ? undefined : copyPreview(record.preview);
    },

    list(): Preview[] {
      void sweepExpired();
      return [...records.values()].map((record) => copyPreview(record.preview));
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      try {
        await Promise.allSettled(
          [...records.values()]
            .filter((record) => record.active || record.handle !== undefined)
            .map((record) => stopPreview(record.preview.previewId)),
        );
        await Promise.allSettled([...inFlightBoots]);
        await Promise.allSettled(
          [...records.values()]
            .filter((record) => record.handle !== undefined)
            .map((record) => stopPreview(record.preview.previewId)),
        );
      } finally {
        shuttingDown = false;
      }
    },

    onChange(cb: (p: Preview) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  async function finishBoot(
    previewId: string,
    spec: PreviewSpec,
  ): Promise<void> {
    try {
      const handle = await args.engine.boot(spec);

      const record = records.get(previewId);
      if (record === undefined) {
        await stopHandle(handle);
        return;
      }

      if (
        shuttingDown ||
        record.stopRequested ||
        record.preview.state === "stopped"
      ) {
        await stopHandle(handle);
        return;
      }

      record.handle = handle;
      handle.onExit((info) => {
        const current = records.get(previewId);
        if (
          current === undefined ||
          current.handle !== handle ||
          current.stopRequested ||
          !current.active
        ) {
          return;
        }
        current.handle = undefined;
        current.active = false;
        storeAndEmit(current, {
          ...withoutTransientFields(current.preview),
          state: "crashed",
          message: info.message,
        });
      });

      const ttlSec = spec.limits?.idleTtlSec ?? args.config.defaultIdleTtlSec;
      storeAndEmit(record, {
        ...record.preview,
        state: "ready",
        url: handle.url,
        expiresAt: isoAt(now() + ttlSec * 1000),
      });
    } catch (error) {
      const record = records.get(previewId);
      if (record === undefined) {
        return;
      }

      record.active = false;

      if (!record.stopRequested && record.preview.state !== "stopped") {
        storeAndEmit(record, {
          ...withoutTransientFields(record.preview),
          state: "crashed",
          message: errorMessage(error),
        });
      }
    }
  }

  async function sweepExpired(): Promise<void> {
    const nowMs = now();
    const expired = [...records.values()]
      .filter((record) => {
        const preview = record.preview;
        return (
          record.active &&
          preview.state === "ready" &&
          preview.expiresAt !== undefined &&
          Date.parse(preview.expiresAt) <= nowMs
        );
      })
      .map((record) => record.preview.previewId);

    await Promise.allSettled(expired.map(expirePreview));
  }

  async function expirePreview(previewId: string): Promise<void> {
    await stopPreview(previewId);
  }

  async function stopPreview(previewId: string): Promise<void> {
    const record = records.get(previewId);
    if (record === undefined || record.preview.state === "stopped") {
      return;
    }

    record.stopRequested = true;
    record.active = false;

    const handle = record.handle;
    record.handle = undefined;

    storeAndEmit(record, stoppedPreview(record.preview));

    if (handle !== undefined) {
      await stopHandle(handle);
    }
  }

  async function stopHandle(handle: PreviewHandle): Promise<void> {
    try {
      await handle.stop();
    } catch {
      // Shutdown/TTL teardown is best-effort; the state transition still frees the broker cap.
    }
  }

  function activeCount(): number {
    let count = 0;
    for (const record of records.values()) {
      if (
        record.active &&
        (record.preview.state === "booting" || record.preview.state === "ready")
      ) {
        count += 1;
      }
    }
    return count;
  }

  function createRecord(preview: Preview): void {
    const stored = copyPreview(preview);
    const record: PreviewRecord = {
      preview: stored,
      active: true,
      stopRequested: false,
    };
    records.set(stored.previewId, record);
    emit(stored);
  }

  function storeAndEmit(record: PreviewRecord, preview: Preview): void {
    record.preview = copyPreview(preview);
    emit(record.preview);
  }

  function emit(preview: Preview): void {
    const emitted = copyPreview(preview);
    for (const listener of listeners) {
      try {
        listener(copyPreview(emitted));
      } catch {
        // Listener failures must not affect the broker lifecycle.
      }
    }
  }

  function stoppedPreview(preview: Preview): Preview {
    return {
      ...withoutTransientFields(preview),
      state: "stopped",
    };
  }

  function requiredRecord(previewId: string): PreviewRecord {
    const record = records.get(previewId);
    if (record === undefined) {
      throw new Error(`Unknown Preview: ${previewId}`);
    }
    return record;
  }

  function isoNow(): string {
    return isoAt(now());
  }

  return broker;
}

interface PreviewRecord {
  preview: Preview;
  handle?: PreviewHandle;
  active: boolean;
  stopRequested: boolean;
}

function withoutTransientFields(preview: Preview): Preview {
  const {
    url: _url,
    expiresAt: _expiresAt,
    message: _message,
    ...base
  } = preview;
  return base;
}

function copyPreview(preview: Preview): Preview {
  return { ...preview };
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
