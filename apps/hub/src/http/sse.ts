const encoder = new TextEncoder();

export interface SseStateStreamOptions {
  snapshot: () => unknown;
  subscribe: (sendState: () => void) => () => void;
  events?: SseEventSubscription[];
  pingMs?: number;
}

export interface SseEventSubscription {
  event: string;
  subscribe: (send: (data: unknown) => void) => () => void;
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

  return new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };
      const sendEvent = (event: string, data: unknown) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const sendState = () => {
        sendEvent("state", snapshot());
      };

      sendState();
      unsubscribe = subscribe(sendState);
      for (const event of events) {
        extraUnsubscribers.push(
          event.subscribe((data) => sendEvent(event.event, data)),
        );
      }
      ping = setInterval(() => write(": ping\n\n"), pingMs);
    },
    cancel() {
      unsubscribe?.();
      for (const unsubscribeExtra of extraUnsubscribers.splice(0)) {
        unsubscribeExtra();
      }
      if (ping !== undefined) {
        clearInterval(ping);
      }
    },
  });
}
