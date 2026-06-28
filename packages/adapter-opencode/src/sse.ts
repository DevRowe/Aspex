export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SseClientOptions {
  url: string;
  fetch?: FetchFn;
  baseDelayMs?: number;
  maxDelayMs?: number;
  setTimeout?: (
    fn: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface SseClientHandlers {
  event(data: unknown): void;
  keepalive(): void;
  error(error: unknown): void;
}

interface PendingEvent {
  event?: string;
  data: string[];
}

export class SseClient {
  private stopped = true;
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fetchImpl: FetchFn;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly setTimer: NonNullable<SseClientOptions["setTimeout"]>;
  private readonly clearTimer: NonNullable<SseClientOptions["clearTimeout"]>;

  constructor(private readonly options: SseClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.maxDelayMs = options.maxDelayMs ?? 5_000;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
  }

  start(handlers: SseClientHandlers): void {
    this.stopped = false;
    void this.connect(handlers, 0);
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;

    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connect(
    handlers: SseClientHandlers,
    attempt: number,
  ): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.abortController = new AbortController();

    try {
      const response = await this.fetchImpl(this.options.url, {
        headers: { Accept: "text/event-stream" },
        signal: this.abortController.signal,
      });

      if (!response.ok || response.body === null) {
        throw new Error(
          `OpenCode event stream failed: ${response.status} ${response.statusText}`,
        );
      }

      await readEventStream(response.body, handlers);

      if (!this.stopped) {
        this.scheduleReconnect(handlers, attempt + 1);
      }
    } catch (error) {
      if (this.stopped || isAbortError(error)) {
        return;
      }

      handlers.error(error);
      this.scheduleReconnect(handlers, attempt + 1);
    }
  }

  private scheduleReconnect(
    handlers: SseClientHandlers,
    attempt: number,
  ): void {
    const delayMs = Math.min(
      this.baseDelayMs * 2 ** Math.max(0, attempt - 1),
      this.maxDelayMs,
    );

    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.connect(handlers, attempt);
    }, delayMs);
  }
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  handlers: SseClientHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: PendingEvent = { data: [] };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      pending = processLine(line, pending, handlers);
    }
  }

  buffer += decoder.decode();

  if (buffer.length > 0) {
    pending = processLine(buffer, pending, handlers);
  }

  dispatchPending(pending, handlers);
}

function processLine(
  line: string,
  pending: PendingEvent,
  handlers: SseClientHandlers,
): PendingEvent {
  if (line.trim().length === 0) {
    dispatchPending(pending, handlers);

    return { data: [] };
  }

  if (line.startsWith(":")) {
    handlers.keepalive();

    return pending;
  }

  const separator = line.indexOf(":");
  const field = separator === -1 ? line : line.slice(0, separator);
  const rawValue = separator === -1 ? "" : line.slice(separator + 1);
  const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

  if (field === "event") {
    return { ...pending, event: value };
  }

  if (field === "data") {
    return { ...pending, data: [...pending.data, value] };
  }

  return pending;
}

function dispatchPending(
  pending: PendingEvent,
  handlers: SseClientHandlers,
): void {
  if (pending.event === undefined && pending.data.length === 0) {
    return;
  }

  const data = pending.data.join("\n");
  const parsed = parseData(data);

  handlers.event(
    pending.event === undefined
      ? parsed
      : { event: pending.event, data: parsed },
  );
}

function parseData(data: string): unknown {
  if (data.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
