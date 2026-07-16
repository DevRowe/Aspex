import { afterEach, describe, expect, test } from "bun:test";
import { useStore } from "../store";
import { connect, runAction } from "./hubClient";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;
const originalHubToken = process.env.VITE_HUB_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: unknown }).window = originalWindow;
  if (originalHubToken === undefined) {
    process.env.VITE_HUB_TOKEN = undefined;
  } else {
    process.env.VITE_HUB_TOKEN = originalHubToken;
  }
  useStore.getState().setConnected(false);
});

describe("hubClient auth", () => {
  test("streams over fetch with the Tauri Hub token as a bearer header", async () => {
    let request: Request | undefined;
    (globalThis as { window?: unknown }).window = tauriWindow("stream-token");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(
        new Response(
          sseBody([
            'event: state\ndata: {"items":[],"generatedAt":"2026-07-17T00:00:00.000Z"}\n\n',
            ": heartbeat\n\n",
            'event: totally-new\ndata: {"anything":true}\n\n',
          ]),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    }) as typeof fetch;

    const stream = await connect();
    await tick();
    stream.close();

    expect(request?.url).toBe("http://127.0.0.1:4317/stream");
    expect(request?.url).not.toContain("token=");
    expect(request?.headers.get("authorization")).toBe("Bearer stream-token");
    expect(request?.headers.get("accept")).toBe("text/event-stream");
    expect(useStore.getState().connected).toBe(true);
  });

  test("reconnects after the stream ends and stops when closed", async () => {
    const requests: Request[] = [];
    (globalThis as { window?: unknown }).window = tauriWindow("stream-token");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        new Response(sseBody([], { close: true }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as typeof fetch;

    const stream = await connect();
    await tick();

    expect(requests).toHaveLength(1);
    expect(useStore.getState().connected).toBe(false);
    stream.close();
  });

  test("halts reconnection when the stream rejects the bearer token", async () => {
    const retryDelays: number[] = [];
    const errors: unknown[][] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalConsoleError = console.error;
    (globalThis as { window?: unknown }).window = tauriWindow("stream-token");
    globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response("unauthorized", { status: 401 }),
      )) as typeof fetch;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    globalThis.setTimeout = ((handler: () => void, delay?: number) => {
      if (delay !== undefined && delay > 0) {
        retryDelays.push(delay);
      }
      return originalSetTimeout(handler, delay);
    }) as typeof setTimeout;

    try {
      const stream = await connect();
      await tick();
      stream.close();
    } finally {
      console.error = originalConsoleError;
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(errors).toHaveLength(1);
    expect(retryDelays).toEqual([]);
    expect(useStore.getState().connected).toBe(false);
  });

  test("sends the Tauri Hub token on action requests", async () => {
    let request: Request | undefined;
    (globalThis as { window?: unknown }).window = tauriWindow("action-token");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ ok: true, message: "done" }));
    }) as typeof fetch;

    await runAction("github:pr:owner/repo#42", "approve", true);

    expect(request?.headers.get("authorization")).toBe("Bearer action-token");
    expect(request?.headers.get("content-type")).toBe("application/json");
  });

  test("sends an explicit merge word with a confirmed ship action", async () => {
    let request: Request | undefined;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ ok: true, message: "done" }));
    }) as typeof fetch;

    await runAction("orchestrator:giles:task", "ship", true, {
      mergeWord: "merge",
    });

    expect(await request?.json()).toEqual({
      confirmed: true,
      payload: { mergeWord: "merge" },
    });
  });

  test("prefers the Tauri Hub token over a configured Vite token", async () => {
    let request: Request | undefined;
    process.env.VITE_HUB_TOKEN = "vite-token";
    (globalThis as { window?: unknown }).window = tauriWindow("tauri-token");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ ok: true, message: "done" }));
    }) as typeof fetch;

    await runAction("github:pr:owner/repo#42", "approve", true);

    expect(request?.headers.get("authorization")).toBe("Bearer tauri-token");
  });

  test("uses configured Vite token for browser development", async () => {
    let request: Request | undefined;
    process.env.VITE_HUB_TOKEN = "vite-token";
    (globalThis as { window?: unknown }).window = undefined;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ ok: true, message: "done" }));
    }) as typeof fetch;

    await runAction("github:pr:owner/repo#42", "approve", true);

    expect(request?.headers.get("authorization")).toBe("Bearer vite-token");
  });
});

function sseBody(
  chunks: string[],
  options: { close?: boolean } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (options.close === true) {
        controller.close();
      }
    },
  });
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function tauriWindow(token: string): unknown {
  return {
    __TAURI__: {
      core: {
        invoke: async (command: string) =>
          command === "hub_token" ? token : "http://127.0.0.1:4317",
      },
    },
  };
}
