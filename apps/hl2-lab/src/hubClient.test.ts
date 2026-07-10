import { describe, expect, test } from "bun:test";
import { HubClient } from "./hubClient";
import { ranked } from "./testFixtures";

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  listeners = new Map<string, EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  state(value: unknown): void {
    this.listeners.get("state")?.(
      new MessageEvent("state", { data: JSON.stringify(value) }),
    );
  }
}

describe("HubClient", () => {
  test("hydrates with bearer auth before opening an in-memory tokenized SSE URL", async () => {
    let request: Request | undefined;
    let streamUrl = "";
    const stream = new FakeEventSource();
    const states: unknown[] = [];
    const phases: string[] = [];
    const client = new HubClient(
      () => ({ hubUrl: "https://hub.tailnet.test/", token: "secret-token" }),
      {
        onState: (state) => states.push(state),
        onConnection: (state) => phases.push(state.phase),
        onMalformed: () => undefined,
      },
      {
        fetcher: ((input, init) => {
          request = new Request(input, init);
          return Promise.resolve(Response.json(ranked()));
        }) as typeof fetch,
        eventSource: (url) => {
          streamUrl = url;
          return stream;
        },
      },
    );

    client.start();
    await tick();

    expect(request?.url).toBe("https://hub.tailnet.test/state");
    expect(request?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(streamUrl).toBe(
      "https://hub.tailnet.test/stream?token=secret-token",
    );
    expect(states).toHaveLength(1);
    stream.onopen?.(new Event("open"));
    expect(phases.at(-1)).toBe("live");
  });

  test("reports auth failure without opening a stream", async () => {
    let opened = false;
    const phases: string[] = [];
    const client = new HubClient(
      () => ({ hubUrl: "https://hub.test", token: "bad" }),
      {
        onState: () => undefined,
        onConnection: (state) => phases.push(state.phase),
        onMalformed: () => undefined,
      },
      {
        fetcher: (() =>
          Promise.resolve(
            new Response(null, { status: 401 }),
          )) as unknown as typeof fetch,
        eventSource: () => {
          opened = true;
          return new FakeEventSource();
        },
      },
    );
    client.start();
    await tick();
    expect(opened).toBe(false);
    expect(phases.at(-1)).toBe("auth_failed");
  });

  test("preserves prior state, reports malformed events, and reconnects with backoff", async () => {
    const streams: FakeEventSource[] = [];
    const timers: Array<() => void> = [];
    const malformed: string[] = [];
    const states: unknown[] = [];
    const client = new HubClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      {
        onState: (state) => states.push(state),
        onConnection: () => undefined,
        onMalformed: (message) => malformed.push(message),
      },
      {
        fetcher: (() =>
          Promise.resolve(Response.json(ranked()))) as unknown as typeof fetch,
        eventSource: () => {
          const stream = new FakeEventSource();
          streams.push(stream);
          return stream;
        },
        setTimer: (callback) => {
          timers.push(callback);
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );

    client.start();
    await tick();
    streams[0]?.state({ nope: true });
    expect(malformed).toHaveLength(1);
    expect(states).toHaveLength(1);

    streams[0]?.onerror?.(new Event("error"));
    expect(timers).toHaveLength(1);
    timers[0]?.();
    await tick();
    expect(streams).toHaveLength(2);
    expect(states).toHaveLength(2);
  });

  test("ignores a stale pairing hydration and its later stream callbacks", async () => {
    const responses: Array<(response: Response) => void> = [];
    const streams: FakeEventSource[] = [];
    const states: string[] = [];
    const phases: string[] = [];
    const client = new HubClient(
      () => ({ hubUrl: "https://hub.test", token: "token" }),
      {
        onState: (state) => states.push(state.generatedAt),
        onConnection: (state) => phases.push(state.phase),
        onMalformed: () => undefined,
      },
      {
        fetcher: (() =>
          new Promise<Response>((resolve) =>
            responses.push(resolve),
          )) as unknown as typeof fetch,
        eventSource: () => {
          const stream = new FakeEventSource();
          streams.push(stream);
          return stream;
        },
      },
    );

    client.start();
    client.start();
    expect(responses).toHaveLength(2);

    responses[0]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:01.000Z" })),
    );
    await tick();
    expect(states).toEqual([]);
    expect(streams).toEqual([]);

    responses[1]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:02.000Z" })),
    );
    await tick();
    expect(states).toEqual(["2026-07-10T00:00:02.000Z"]);
    const staleStream = streams[0];
    expect(staleStream).toBeDefined();

    client.start();
    responses[2]?.(
      Response.json(ranked({ generatedAt: "2026-07-10T00:00:03.000Z" })),
    );
    await tick();
    expect(states).toEqual([
      "2026-07-10T00:00:02.000Z",
      "2026-07-10T00:00:03.000Z",
    ]);

    staleStream?.state(ranked({ generatedAt: "2026-07-10T00:00:04.000Z" }));
    staleStream?.onopen?.(new Event("open"));
    staleStream?.onerror?.(new Event("error"));

    expect(states).toEqual([
      "2026-07-10T00:00:02.000Z",
      "2026-07-10T00:00:03.000Z",
    ]);
    expect(phases.at(-1)).toBe("connecting");
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
