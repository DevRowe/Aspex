const encoder = new TextEncoder();

export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseStateStreamOptions {
  // Sent once on connect; inherently per-connection.
  snapshot: () => unknown;
  // Delivers pre-encoded SSE frames. The producer side is shared across all
  // connections (see createSharedFrameSource) so one world event encodes once.
  subscribe: (send: (frame: string) => void) => () => void;
  events?: SseEventSubscription[];
  pingMs?: number;
}

export interface SseEventSubscription {
  event: string;
  subscribe: (send: (data: unknown) => void) => () => void;
}

// Fan-out with a single upstream subscription: the frame is encoded once per
// upstream event and handed to every connected stream. A snapshot-then-deltas
// migration swaps only the encode function; subscribers are untouched.
export function createSharedFrameSource(options: {
  encode: () => string;
  attach: (notify: () => void) => () => void;
}): (send: (frame: string) => void) => () => void {
  const listeners = new Set<(frame: string) => void>();
  let detach: (() => void) | undefined;

  const notify = () => {
    if (listeners.size === 0) {
      return;
    }
    const frame = options.encode();
    for (const listener of [...listeners]) {
      listener(frame);
    }
  };

  return (send) => {
    listeners.add(send);
    if (listeners.size === 1) {
      detach = options.attach(notify);
    }

    return () => {
      if (!listeners.delete(send)) {
        return;
      }
      if (listeners.size === 0) {
        detach?.();
        detach = undefined;
      }
    };
  };
}

export function createStateStream({
  snapshot,
  subscribe,
  events = [],
  pingMs = 15_000,
}: SseStateStreamOptions): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | undefined;
  const extraUnsubscribers: Array<() => void> = [];
  let ping: Timer | undefined;
  let closed = false;

  const teardown = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    for (const unsubscribeExtra of extraUnsubscribers.splice(0)) {
      unsubscribeExtra();
    }
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
      const sendEvent = (event: string, data: unknown) => {
        write(encodeSseEvent(event, data));
      };

      sendEvent("state", snapshot());
      if (closed) {
        return;
      }
      unsubscribe = subscribe(write);
      for (const event of events) {
        extraUnsubscribers.push(
          event.subscribe((data) => sendEvent(event.event, data)),
        );
      }
      ping = setInterval(() => write(": ping\n\n"), pingMs);
    },
    cancel() {
      closed = true;
      teardown();
    },
  });
}
