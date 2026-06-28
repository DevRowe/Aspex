import type { Transcript } from "@aspex/schema";

export interface SttClient {
  transcribe(audio: Uint8Array, mime: string): Promise<Transcript>;
}

export interface HttpSttConfig {
  endpoints: string[];
  timeoutMs: number;
}

export class VoiceServiceError extends Error {
  constructor(
    message: string,
    readonly failures: unknown[] = [],
  ) {
    super(message);
    this.name = "VoiceServiceError";
  }
}

export class HttpSttClient implements SttClient {
  constructor(private cfg: HttpSttConfig) {}

  async transcribe(audio: Uint8Array, mime: string): Promise<Transcript> {
    const failures: unknown[] = [];

    for (const endpoint of this.cfg.endpoints) {
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "content-type": mime },
            body: toArrayBuffer(audio),
          },
          this.cfg.timeoutMs,
        );

        if (!response.ok) {
          failures.push(new Error(`${endpoint} returned ${response.status}`));
          continue;
        }

        const body = await response.json();
        if (!isTranscript(body)) {
          failures.push(new Error(`${endpoint} returned invalid transcript`));
          continue;
        }

        return body;
      } catch (error) {
        failures.push(error);
      }
    }

    throw new VoiceServiceError("All STT endpoints failed", failures);
  }
}

export class MockSttClient implements SttClient {
  private script: Transcript[];

  constructor(script: Array<Transcript | string> = []) {
    this.script = script.map((entry) =>
      typeof entry === "string" ? { text: entry, confidence: 1 } : entry,
    );
  }

  async transcribe(_audio: Uint8Array, _mime: string): Promise<Transcript> {
    return this.script.shift() ?? { text: "", confidence: 1 };
  }
}

function isTranscript(value: unknown): value is Transcript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string" &&
    typeof (value as { confidence?: unknown }).confidence === "number" &&
    Number.isFinite((value as { confidence: number }).confidence) &&
    (value as { confidence: number }).confidence >= 0 &&
    (value as { confidence: number }).confidence <= 1
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("STT request timed out", "AbortError"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
