export interface TtsClient {
  speak(text: string): Promise<Uint8Array | null>;
}

export interface HttpTtsConfig {
  endpoint: string;
  timeoutMs: number;
}

export class HttpTtsClient implements TtsClient {
  constructor(private cfg: HttpTtsConfig) {}

  async speak(text: string): Promise<Uint8Array | null> {
    try {
      const response = await fetchWithTimeout(
        this.cfg.endpoint,
        {
          method: "POST",
          headers: {
            accept: "audio/wav",
            "content-type": "application/json",
          },
          body: JSON.stringify({ text }),
        },
        this.cfg.timeoutMs,
      );

      if (response.status === 204) {
        return null;
      }

      if (response.status !== 200) {
        return null;
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }
}

export interface MockTtsConfig {
  disabled?: boolean;
}

export class MockTtsClient implements TtsClient {
  constructor(private cfg: MockTtsConfig = {}) {}

  async speak(): Promise<Uint8Array | null> {
    if (this.cfg.disabled) {
      return null;
    }

    return new Uint8Array(SILENT_WAV);
  }
}

const SILENT_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66,
  0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f,
  0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74,
  0x61, 0x00, 0x00, 0x00, 0x00,
]);

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
      reject(new DOMException("TTS request timed out", "AbortError"));
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
