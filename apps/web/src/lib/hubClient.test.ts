import { afterEach, describe, expect, test } from "bun:test";
import { connect, runAction } from "./hubClient";

const originalEventSource = (globalThis as { EventSource?: unknown })
  .EventSource;
const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;
const originalHubToken = process.env.VITE_HUB_TOKEN;

afterEach(() => {
  (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
  (globalThis as { window?: unknown }).window = originalWindow;
  if (originalHubToken === undefined) {
    process.env.VITE_HUB_TOKEN = undefined;
  } else {
    process.env.VITE_HUB_TOKEN = originalHubToken;
  }
});

describe("hubClient auth", () => {
  test("appends the Tauri Hub token to the EventSource stream URL", async () => {
    const urls: string[] = [];
    (globalThis as { window?: unknown }).window = tauriWindow("stream-token");
    (globalThis as { EventSource?: unknown }).EventSource = class {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(readonly url: string) {
        urls.push(url);
      }

      addEventListener() {}
    };

    await connect();

    expect(urls).toEqual(["http://127.0.0.1:4317/stream?token=stream-token"]);
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
