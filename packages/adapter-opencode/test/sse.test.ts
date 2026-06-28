import { describe, expect, test } from "bun:test";
import { SseClient } from "../src/sse";

describe("SseClient", () => {
  test("connection failures reconnect with bounded backoff and stop clears the timer", async () => {
    const timers: Array<{ fn: () => void; delayMs: number }> = [];
    const cleared: unknown[] = [];
    const errors: unknown[] = [];
    const client = new SseClient({
      url: "http://127.0.0.1:4096/event",
      fetch: async () => {
        throw new Error("opencode is not running");
      },
      baseDelayMs: 10,
      maxDelayMs: 15,
      setTimeout: (fn, delayMs) => {
        const timer = { fn, delayMs };
        timers.push(timer);

        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (timer) => {
        cleared.push(timer);
      },
    });

    client.start({
      event: () => {},
      keepalive: () => {},
      error: (error) => errors.push(error),
    });
    await Bun.sleep(0);

    expect(errors).toHaveLength(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(10);

    client.stop();

    expect(cleared).toEqual([timers[0]]);
  });
});
