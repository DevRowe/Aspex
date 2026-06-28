import { mapClaudeHookToSignal } from "./index";

export type HookRelaySource = "claude-code" | "codex";

export interface HookRelayOptions {
  event?: string;
  hubPort: number;
  source?: HookRelaySource;
  jsonArg?: string;
  stdin?: ReadableStream<Uint8Array>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function runHookRelay(options: HookRelayOptions): Promise<void> {
  try {
    const input =
      options.jsonArg ?? (await readAll(options.stdin ?? Bun.stdin.stream()));
    const payload = JSON.parse(input === "" ? "{}" : input);
    const source = options.source ?? "claude-code";
    const signal = await mapPayloadToSignal(source, options.event, payload);

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
        `http://127.0.0.1:${options.hubPort}/signals/${source}`,
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

async function mapPayloadToSignal(
  source: HookRelaySource,
  event: string | undefined,
  payload: unknown,
) {
  if (source === "codex") {
    const { mapCodexNotifyToSignal } = await import("@aspex/adapter-codex");

    return mapCodexNotifyToSignal(isRecord(payload) ? payload : {});
  }

  if (event === undefined || event.trim() === "") {
    return null;
  }

  return mapClaudeHookToSignal(event, isRecord(payload) ? payload : {});
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
