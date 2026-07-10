import { isMergeWord } from "@aspex/schema";
import {
  type LogicalAction,
  type LogicalDispatch,
  createIntentId,
} from "./intentIds";

export type DirectionResult =
  | {
      kind: "delivered";
      ok: boolean;
      message: string;
      status: number;
      body: unknown;
    }
  | { kind: "confirmation_required"; message: string; status: 409 }
  | { kind: "failed"; message: string; status: number; retryable: boolean };

export interface DirectionConfig {
  hubUrl: string;
  token: string;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class DirectionClient {
  private readonly fetcher: Fetcher;

  constructor(
    private config: () => DirectionConfig,
    fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  beginAction(
    itemId: string,
    actionId: string,
    payload?: Record<string, unknown>,
  ): LogicalAction {
    return {
      intentId: createIntentId(actionId),
      itemId,
      actionId,
      ...(payload ? { payload } : {}),
    };
  }

  beginDispatch(
    instruction: string,
    project?: string,
    orchestrator = "giles",
  ): LogicalDispatch {
    return {
      intentId: createIntentId("dispatch"),
      orchestrator,
      instruction,
      ...(project?.trim() ? { project: project.trim() } : {}),
    };
  }

  async action(
    operation: LogicalAction,
    confirmed = false,
  ): Promise<DirectionResult> {
    if (
      operation.actionId === "ship" &&
      confirmed &&
      !isMergeWord(operation.payload?.mergeWord)
    ) {
      return {
        kind: "failed",
        message: "Enter merge or ship to confirm review & ship.",
        status: 400,
        retryable: false,
      };
    }
    const cfg = this.config();
    return this.send(
      `${trimUrl(cfg.hubUrl)}/actions/${encodeURIComponent(operation.itemId)}/${encodeURIComponent(operation.actionId)}`,
      {
        confirmed,
        intentId: operation.intentId,
        ...(operation.payload ? { payload: operation.payload } : {}),
      },
      cfg.token,
    );
  }

  async dispatch(
    operation: LogicalDispatch,
    confirmed = false,
  ): Promise<DirectionResult> {
    const cfg = this.config();
    return this.send(
      `${trimUrl(cfg.hubUrl)}/intents`,
      { verb: "dispatch", ...operation, confirmed },
      cfg.token,
    );
  }

  async statusQuery(
    scope: "needs_me" | string = "needs_me",
  ): Promise<DirectionResult> {
    const cfg = this.config();
    return this.send(
      `${trimUrl(cfg.hubUrl)}/intents`,
      { verb: "status_query", intentId: createIntentId("status"), scope },
      cfg.token,
    );
  }

  private async send(
    url: string,
    body: unknown,
    token: string,
  ): Promise<DirectionResult> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        kind: "failed",
        message: "Hub unreachable; retry keeps the same intent id.",
        status: 0,
        retryable: true,
      };
    }

    const parsed = await response.json().catch(() => null);
    const message = responseMessage(parsed, response.statusText);
    if (response.status === 409) {
      return { kind: "confirmation_required", message, status: 409 };
    }
    if (!response.ok) {
      return {
        kind: "failed",
        message,
        status: response.status,
        retryable: response.status >= 500,
      };
    }
    if (isFailedDirectionResponse(parsed)) {
      return {
        kind: "failed",
        message,
        status: response.status,
        retryable: true,
      };
    }
    return {
      kind: "delivered",
      ok: response.ok,
      message,
      status: response.status,
      body: parsed,
    };
  }
}

function isFailedDirectionResponse(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).ok === false
  );
}

function responseMessage(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.text === "string") {
      return record.text;
    }
  }
  return fallback || "Done.";
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
