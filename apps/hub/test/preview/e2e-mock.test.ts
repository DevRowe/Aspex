import { afterEach, describe, expect, test } from "bun:test";
import type { Preview, PreviewSpec } from "@aspex/schema";
import { buildHub } from "../../src/boot";
import { DEFAULT_CONFIG } from "../../src/config";

const trustedSpec: PreviewSpec = {
  id: "trusted-web",
  name: "Trusted Web",
  engine: "mock",
  image: "example/trusted-web:latest",
  port: 3000,
  trust: "trusted",
  itemId: "github:pr:owner/repo#45",
  limits: { idleTtlSec: 60 },
};

const untrustedSpec: PreviewSpec = {
  id: "untrusted-web",
  name: "Untrusted Web",
  engine: "mock",
  image: "example/untrusted-web:latest",
  port: 3000,
  trust: "untrusted",
  limits: { idleTtlSec: 60 },
};

const openHubs: Array<ReturnType<typeof buildHub>> = [];

afterEach(async () => {
  const hubs = openHubs.splice(0);
  await Promise.allSettled(hubs.map((hub) => hub.stop()));
});

describe("Preview Deck mock E2E", () => {
  test("boots, streams, reads, stops, and enforces v1 guardrails through the real Hub app", async () => {
    const hub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      previews: {
        enabled: true,
        engine: "mock",
        maxConcurrent: 1,
        limits: { cpus: "1", memory: "128m", idleTtlSec: 60 },
        specs: [trustedSpec, untrustedSpec],
      },
    });
    openHubs.push(hub);
    await hub.start();

    const streamResponse = await hub.app.fetch(
      new Request("http://hub.test/stream"),
    );
    expect(streamResponse.status).toBe(200);
    const sse = new SseReader(streamResponse);
    await sse.nextEvent("state");

    const booted = await hub.app.fetch(
      jsonRequest("http://hub.test/previews", { specId: trustedSpec.id }),
    );
    expect(booted.status).toBe(201);
    const bootedPreview = (await booted.json()) as Preview;
    expect(bootedPreview).toMatchObject({
      specId: trustedSpec.id,
      state: "booting",
      trust: "trusted",
    });

    const bootingEvent = await sse.nextPreview((preview) => {
      return (
        preview.previewId === bootedPreview.previewId &&
        preview.state === "booting"
      );
    });
    const readyEvent = await sse.nextPreview((preview) => {
      return (
        preview.previewId === bootedPreview.previewId &&
        preview.state === "ready"
      );
    });
    expect([bootingEvent.state, readyEvent.state]).toEqual([
      "booting",
      "ready",
    ]);

    const fetched = await hub.app.fetch(
      new Request(`http://hub.test/previews/${bootedPreview.previewId}`),
    );
    expect(fetched.status).toBe(200);
    const fetchedPreview = (await fetched.json()) as Preview;
    expect(fetchedPreview).toMatchObject({
      previewId: bootedPreview.previewId,
      specId: trustedSpec.id,
      state: "ready",
    });
    expect(fetchedPreview.url?.startsWith("http://127.0.0.1:")).toBe(true);

    const capped = await hub.app.fetch(
      jsonRequest("http://hub.test/previews", { specId: trustedSpec.id }),
    );
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ message: "too many previews open" });

    const untrusted = await hub.app.fetch(
      jsonRequest("http://hub.test/previews", { specId: untrustedSpec.id }),
    );
    expect(untrusted.status).toBe(403);
    expect(await untrusted.json()).toEqual({
      message: "Untrusted Preview spec: pixels lane not yet available",
    });

    const stopped = await hub.app.fetch(
      new Request(`http://hub.test/previews/${bootedPreview.previewId}`, {
        method: "DELETE",
      }),
    );
    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe("");

    const stoppedEvent = await sse.nextPreview((preview) => {
      return (
        preview.previewId === bootedPreview.previewId &&
        preview.state === "stopped"
      );
    });
    expect(stoppedEvent.state).toBe("stopped");

    const listed = await hub.app.fetch(new Request("http://hub.test/previews"));
    expect(listed.status).toBe(200);
    const previews = (await listed.json()) as Preview[];
    expect(
      previews.filter(
        (preview) => preview.state === "booting" || preview.state === "ready",
      ),
    ).toEqual([]);

    await sse.close();
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(response: Response) {
    if (response.body === null) {
      throw new Error("Expected SSE response body");
    }
    this.reader = response.body.getReader();
  }

  async nextEvent(eventName?: string): Promise<SseEvent> {
    const deadline = Date.now() + 1000;

    while (Date.now() < deadline) {
      const parsed = this.shiftEvent();
      if (parsed !== undefined) {
        if (eventName === undefined || parsed.event === eventName) {
          return parsed;
        }
        continue;
      }

      const remainingMs = Math.max(1, deadline - Date.now());
      const read = await Promise.race([
        this.reader.read(),
        delay(remainingMs).then(() => "timeout" as const),
      ]);
      if (read === "timeout") {
        break;
      }
      if (read.done === true) {
        break;
      }
      this.buffer += this.decoder.decode(read.value, { stream: true });
    }

    throw new Error(`Timed out waiting for SSE event ${eventName ?? "*"}`);
  }

  async nextPreview(
    predicate: (preview: Preview) => boolean,
  ): Promise<Preview> {
    while (true) {
      const event = await this.nextEvent("preview");
      const preview = event.data as Preview;
      if (predicate(preview)) {
        return preview;
      }
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel();
  }

  private shiftEvent(): SseEvent | undefined {
    const separator = this.buffer.indexOf("\n\n");
    if (separator === -1) {
      return undefined;
    }

    const raw = this.buffer.slice(0, separator);
    this.buffer = this.buffer.slice(separator + 2);

    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice("event: ".length);
      } else if (line.startsWith("data: ")) {
        data += line.slice("data: ".length);
      }
    }

    return { event, data: JSON.parse(data) };
  }
}

interface SseEvent {
  event: string;
  data: unknown;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
