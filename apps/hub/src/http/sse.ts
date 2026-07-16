const encoder = new TextEncoder();

// Protocol v1.1 SSE contract (docs/hub-api.md): every broadcast event carries
// a monotonic `id:`, the stream honors `Last-Event-ID` from a bounded replay
// ring buffer (falling back to a fresh snapshot when the id is too old), the
// server advertises `retry:`, and keepalives are a named `ping` event instead
// of a comment so non-browser clients that parse frames themselves see them.
// Clients must ignore event types and fields they do not recognize.

export const DEFAULT_RETRY_MS = 3_000;
export const DEFAULT_REPLAY_BUFFER_SIZE = 256;

export function encodeSseEvent(
  event: string,
  data: unknown,
  id?: number,
): string {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// One broadcaster per app: assigns ids, encodes each event exactly once,
// keeps the bounded replay ring, and fans encoded frames out to every
// connected stream. It stays attached to its producers for the lifetime of
// the app - buffering while no client is connected is exactly what makes a
// reconnect with Last-Event-ID resumable.
export interface SseBroadcaster {
  publish(event: string, data: unknown): void;
  subscribe(send: (frame: string) => void): () => void;
  lastEventId(): number;
  // Frames the client missed after lastEventId, oldest first; [] when it is
  // current; null when the id predates the ring (or is unknown), in which
  // case the caller must send a fresh snapshot instead.
  replaySince(lastEventId: number): string[] | null;
}

export function createSseBroadcaster(
  options: { bufferSize?: number } = {},
): SseBroadcaster {
  const bufferSize = options.bufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
  const ring: Array<{ id: number; frame: string }> = [];
  const listeners = new Set<(frame: string) => void>();
  let lastId = 0;

  return {
    publish(event, data) {
      lastId += 1;
      const frame = encodeSseEvent(event, data, lastId);
      ring.push({ id: lastId, frame });

      while (ring.length > bufferSize) {
        ring.shift();
      }

      for (const listener of [...listeners]) {
        listener(frame);
      }
    },

    subscribe(send) {
      listeners.add(send);
      return () => {
        listeners.delete(send);
      };
    },

    lastEventId() {
      return lastId;
    },

    replaySince(lastEventId) {
      if (lastEventId === lastId) {
        return [];
      }

      // An id from the future (a previous Hub run) or one older than the
      // ring's tail cannot be replayed gaplessly.
      const oldest = ring[0];

      if (
        lastEventId > lastId ||
        lastEventId < 0 ||
        oldest === undefined ||
        lastEventId < oldest.id - 1
      ) {
        return null;
      }

      return ring
        .filter((entry) => entry.id > lastEventId)
        .map((entry) => entry.frame);
    },
  };
}

export interface SseStateStreamOptions {
  // Fresh snapshot, sent on connect (or when replay is impossible), stamped
  // with the broadcaster's current id so the client resumes from it.
  snapshot: () => unknown;
  broadcaster: SseBroadcaster;
  // Parsed Last-Event-ID from the reconnecting client, if any.
  lastEventId?: number;
  retryMs?: number;
  pingMs?: number;
}

export function createStateStream({
  snapshot,
  broadcaster,
  lastEventId,
  retryMs = DEFAULT_RETRY_MS,
  pingMs = 15_000,
}: SseStateStreamOptions): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | undefined;
  let ping: Timer | undefined;
  let closed = false;

  const teardown = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (ping !== undefined) {
      clearInterval(ping);
      ping = undefined;
    }
  };

  return new ReadableStream({
    start(controller) {
      // enqueue throws once the client is gone but before cancel() fires; a
      // dead stream must not throw into the bus emitter (failing the signal
      // ingest and starving later listeners) or into the ping timer.
      const write = (chunk: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          teardown();
          try {
            controller.close();
          } catch {
            // Already closed by the runtime.
          }
        }
      };

      const replayed =
        lastEventId === undefined ? null : broadcaster.replaySince(lastEventId);

      // The retry advice rides the first chunk. A resumable reconnect gets
      // only the missed frames; everything else gets a fresh snapshot
      // stamped with the current id.
      write(
        `retry: ${retryMs}\n\n${
          replayed === null
            ? encodeSseEvent("state", snapshot(), broadcaster.lastEventId())
            : replayed.join("")
        }`,
      );
      if (closed) {
        return;
      }
      unsubscribe = broadcaster.subscribe(write);
      // Keepalives carry no id: they are not resumable events and must not
      // advance the client's Last-Event-ID.
      ping = setInterval(() => write(encodeSseEvent("ping", {})), pingMs);
    },
    cancel() {
      closed = true;
      teardown();
    },
  });
}
