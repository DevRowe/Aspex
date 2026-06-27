const encoder = new TextEncoder();

export interface SseStateStreamOptions {
  snapshot: () => unknown;
  subscribe: (sendState: () => void) => () => void;
  pingMs?: number;
}

export function createStateStream({
  snapshot,
  subscribe,
  pingMs = 15_000,
}: SseStateStreamOptions): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | undefined;
  let ping: Timer | undefined;

  return new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };
      const sendState = () => {
        write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
      };

      sendState();
      unsubscribe = subscribe(sendState);
      ping = setInterval(() => write(": ping\n\n"), pingMs);
    },
    cancel() {
      unsubscribe?.();
      if (ping !== undefined) {
        clearInterval(ping);
      }
    },
  });
}
