import { describe, expect, test } from "bun:test";
import { HubClient } from "./hubClient";
import { ranked } from "./testFixtures";

const encoder = new TextEncoder();

class FakeSseStream {
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
    },
  });

  event(type: string, value: unknown): void {
    this.raw(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
  }

  raw(chunk: string): void {
    this.controller.enqueue(encoder.encode(chunk));
  }

  close(): void {
    this.controller.close();
  }
}

interface Harness {
  client: HubClient;
  requests: Request[];
  streams: FakeSseStream[];
  timers: Array<() => void>;
  states: unknown[];
  phases: string[];
  malformed: string[];
}

function harness(
  overrides: {
    stateResponse?: () => Promise<Response>;
    streamResponse?: () => Promise<Response>;
  } = {},
): Harness {
  const requests: Request[] = [];
  const streams: FakeSseStream[] = [];
  const timers: Array<() => void> = [];
  const states: unknown[] = [];
  const phases: string[] = [];
  const malformed: string[] = [];
  const client = new HubClient(
    () => ({ hubUrl: "https://hub.tailnet.test/", token: "secret-token" }),
    {
      onState: (state) => states.push(state),
      onConnection: (state) => phases.push(state.phase),
      onMalformed: (message) => malformed.push(message),
    },
    {
      fetcher: (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/state")) {
          return (
            overrides.stateResponse?.() ??
            Promise.resolve(Response.json(ranked()))
          );
        }
        if (overrides.streamResponse !== undefined) {
          return overrides.streamResponse();
        }
        const stream = new FakeSseStream();
        streams.push(stream);
        return Promise.resolve(
          new Response(stream.body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    },
  );
  return { client, requests, streams, timers, states, phases, malformed };
}

describe("HubClient", () => {
  test("hydrates and streams with bearer auth, never a token query", async () => {
    const h = harness();
    h.client.start();
    await tick();

    expect(h.requests.map((request) => request.url)).toEqual([
      "https://hub.tailnet.test/state",
      "https://hub.tailnet.test/stream",
    ]);
    for (const request of h.requests) {
      expect(request.headers.get("authorization")).toBe("Bearer secret-token");
      expect(request.url).not.toContain("token=");
    }
    expect(h.requests[1]?.headers.get("accept")).toBe("text/event-stream");
    expect(h.states).toHaveLength(1);
    expect(h.phases.at(-1)).toBe("live");

    h.streams[0]?.event("state", ranked());
    await tick();
    expect(h.states).toHaveLength(2);
  });

  test("parses multi-line and chunk-split SSE frames", async () => {
    const h = harness();
    h.client.start();
    await tick();

    const payload = JSON.stringify(ranked());
    const frame = `event: state\ndata: ${payload}\n\n`;
    h.streams[0]?.raw(frame.slice(0, 12));
    await tick();
    expect(h.states).toHaveLength(1);
    h.streams[0]?.raw(frame.slice(12));
    await tick();
    expect(h.states).toHaveLength(2);
  });

  test("ignores unknown event types and comments", async () => {
    const h = harness();
    h.client.start();
    await tick();

    h.streams[0]?.raw(": heartbeat\n\n");
    h.streams[0]?.event("preview", { anything: true });
    h.streams[0]?.event("totally-new", { anything: true });
    await tick();

    expect(h.states).toHaveLength(1);
    expect(h.malformed).toEqual([]);
    expect(h.phases.at(-1)).toBe("live");
  });

  test("reports auth failure without opening a stream", async () => {
    const h = harness({
      stateResponse: () => Promise.resolve(new Response(null, { status: 401 })),
    });
    h.client.start();
    await tick();
    expect(h.requests).toHaveLength(1);
    expect(h.phases.at(-1)).toBe("auth_failed");
  });

  test("reports auth failure when the stream itself is rejected", async () => {
    const h = harness({
      streamResponse: () =>
        Promise.resolve(new Response(null, { status: 401 })),
    });
    h.client.start();
    await tick();
    expect(h.phases.at(-1)).toBe("auth_failed");
    expect(h.timers).toHaveLength(0);
  });

  test("preserves prior state, reports malformed events, and reconnects with backoff", async () => {
    const h = harness();
    h.client.start();
    await tick();
    h.streams[0]?.event("state", { nope: true });
    await tick();
    expect(h.malformed).toHaveLength(1);
    expect(h.states).toHaveLength(1);

    h.streams[0]?.close();
    await tick();
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.();
    await tick();
    expect(h.streams).toHaveLength(2);
    expect(h.states).toHaveLength(2);
    expect(h.phases.at(-1)).toBe("live");
  });

  test("ignores a stale pairing hydration and its later stream events", async () => {
    const responses: Array<(response: Response) => void> = [];
    const h = harness({
      stateResponse: () =>
        new Promise<Response>((resolve) => responses.push(resolve)),
    });
    const generatedAt = (state: unknown): string =>
      (state as { generatedAt: string }).generatedAt;

    h.client.start();
    h.client.start();
    expect(responses).toHaveLength(2);

    responses[0]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:01.000Z" })),
    );
    await tick();
    expect(h.states).toEqual([]);
    expect(h.streams).toEqual([]);

    responses[1]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:02.000Z" })),
    );
    await tick();
    expect(h.states.map(generatedAt)).toEqual(["2026-07-10T00:00:02.000Z"]);
    const staleStream = h.streams[0];
    expect(staleStream).toBeDefined();

    h.client.start();
    responses[2]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:03.000Z" })),
    );
    await tick();
    expect(h.states.map(generatedAt)).toEqual([
      "2026-07-10T00:00:02.000Z",
      "2026-07-10T00:00:03.000Z",
    ]);

    staleStream?.event(
      "state",
      ranked({ generatedAt: "2026-07-10T00:00:04.000Z" }),
    );
    await tick();
    expect(h.states.map(generatedAt)).toEqual([
      "2026-07-10T00:00:02.000Z",
      "2026-07-10T00:00:03.000Z",
    ]);
  });

  test("stopping aborts the stream without scheduling a reconnect", async () => {
    const h = harness();
    h.client.start();
    await tick();
    expect(h.streams).toHaveLength(1);

    h.client.stop();
    h.streams[0]?.close();
    await tick();
    expect(h.timers).toHaveLength(0);
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
