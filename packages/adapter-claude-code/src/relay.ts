import { mapClaudeHookToSignal } from "./index";

export interface HookRelayOptions {
  event: string;
  hubPort: number;
  stdin?: ReadableStream<Uint8Array>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function runHookRelay(options: HookRelayOptions): Promise<void> {
  try {
    const input = await readAll(options.stdin ?? Bun.stdin.stream());
    const payload = JSON.parse(input === "" ? "{}" : input);
    const signal = mapClaudeHookToSignal(options.event, payload);

    if (signal === null) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 750,
    );

    try {
      await (options.fetch ?? fetch)(
        `http://127.0.0.1:${options.hubPort}/signals/claude-code`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signal),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (_error) {
    return;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value !== undefined) {
      chunks.push(value);
    }
  }

  return new TextDecoder().decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}
