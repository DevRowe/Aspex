import { afterEach, describe, expect, test } from "bun:test";
import type { Preview, PreviewSpec } from "@aspex/schema";
import { PreviewsDisabledError, boot, listSpecs, stop } from "./previewClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("previewClient", () => {
  test("lists specs from the hub", async () => {
    const specs: PreviewSpec[] = [
      {
        id: "web",
        name: "Web app",
        engine: "mock",
        image: "aspex/web:preview",
        port: 5173,
        trust: "trusted",
      },
    ];

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("http://127.0.0.1:4317/previews/specs");
      expect(request.method).toBe("GET");
      return Promise.resolve(Response.json(specs));
    }) as typeof fetch;

    expect(await listSpecs()).toEqual(specs);
  });

  test("treats list 404 as Preview Deck disabled", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("not found", { status: 404 }),
      )) as unknown as typeof fetch;

    await expect(listSpecs()).rejects.toBeInstanceOf(PreviewsDisabledError);
  });

  test("boots and stops previews through declared endpoints", async () => {
    const preview: Preview = {
      previewId: "preview-1",
      specId: "web",
      state: "booting",
      trust: "trusted",
      startedAt: "2026-06-28T00:00:00.000Z",
    };
    const requests: Request[] = [];

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);

      if (request.method === "POST") {
        return Promise.resolve(Response.json(preview, { status: 201 }));
      }

      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    expect(await boot("web")).toEqual(preview);
    await stop("preview-1");

    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "POST http://127.0.0.1:4317/previews",
      "DELETE http://127.0.0.1:4317/previews/preview-1",
    ]);
    expect(await requests[0]?.json()).toEqual({ specId: "web" });
  });
});
