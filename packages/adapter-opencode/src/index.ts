import type {
  Action,
  ActionResult,
  Adapter,
  AdapterContext,
} from "@aspex/schema";
import { OPENCODE_SOURCE, isHeartbeatResult, mapEvent } from "./map";
import { type FetchFn, SseClient } from "./sse";

export interface OpenCodeAdapterConfig {
  enabled?: boolean;
  serverUrl: string;
  directory?: string;
}

export interface OpenCodeAdapterOptions {
  fetch?: FetchFn;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OpenCodeAdapter implements Adapter {
  id = OPENCODE_SOURCE;
  private client: SseClient | null = null;

  constructor(
    private readonly config: OpenCodeAdapterConfig,
    private readonly options: OpenCodeAdapterOptions = {},
  ) {}

  async start(ctx: AdapterContext): Promise<void> {
    await this.stop();

    if (this.config.enabled !== true) {
      return;
    }

    this.client = new SseClient({
      url: eventUrl(this.config),
      fetch: this.options.fetch,
      baseDelayMs: this.options.baseDelayMs,
      maxDelayMs: this.options.maxDelayMs,
    });
    this.client.start({
      event: (event) => {
        ctx.heartbeat(OPENCODE_SOURCE);
        const result = mapEvent(event, this.config);

        if (result === null || isHeartbeatResult(result)) {
          return;
        }

        ctx.emit(result);
      },
      keepalive: () => {
        ctx.heartbeat(OPENCODE_SOURCE);
      },
      error: (error) => {
        ctx.log(`opencode event stream unavailable: ${messageFor(error)}`);
      },
    });
  }

  listActions(_itemId: string): Action[] {
    return [];
  }

  async runAction(
    _itemId: string,
    _actionId: string,
    _payload?: unknown,
  ): Promise<ActionResult> {
    return { ok: false, message: "opencode is observe-only in Phase 3" };
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = null;
  }
}

function eventUrl(config: OpenCodeAdapterConfig): string {
  const url = new URL("/event", config.serverUrl.replace(/\/+$/, "/"));

  if (config.directory !== undefined && config.directory.trim().length > 0) {
    url.searchParams.set("directory", config.directory);
  }

  return url.toString();
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from "./map";
export * from "./sse";
