import { afterEach, describe, expect, test } from "bun:test";
import type { Intent, IntentRequest } from "@aspex/schema";
import {
  MockIntentService,
  OllamaIntentService,
} from "../src/voice/intentService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const selectedId = "github:pr:brocorp/aspex#48";
const otherId = "github:pr:brocorp/aspex#49";

describe("OllamaIntentService", () => {
  test("returns a valid action intent from Ollama chat content", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });

      return ollamaResponse({
        kind: "action",
        itemId: selectedId,
        actionId: "approve",
      });
    };

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request())).resolves.toEqual({
      intent: { kind: "action", itemId: selectedId, actionId: "approve" },
      source: "freeform",
    });
    expect(calls[0]?.url).toBe("http://ollama/api/chat");
    expect(calls[0]?.body).toMatchObject({
      model: "llama3.1",
      stream: false,
      messages: [{ role: "user", content: expect.any(String) }],
      format: expect.any(Object),
    });
  });

  test("falls back to the second endpoint in order", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response("broken", { status: 500 });
      }

      return ollamaResponse({
        kind: "read",
        target: otherId,
      });
    };

    const client = new OllamaIntentService({
      endpoints: ["http://first/", "http://second"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request())).resolves.toEqual({
      intent: { kind: "read", target: otherId },
      source: "freeform",
    });
    expect(calls).toEqual(["http://first/api/chat", "http://second/api/chat"]);
  });

  test("returns no_match when all endpoints fail or time out", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Promise<Response>(() => {});
      }
      throw new Error("offline");
    };

    const client = new OllamaIntentService({
      endpoints: ["http://slow", "http://offline"],
      model: "llama3.1",
      timeoutMs: 1,
    });

    await expect(client.resolve(request("do the thing"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "do the thing",
        reason: "unknown_command",
      },
      source: "freeform",
    });
    expect(calls).toEqual(["http://slow/api/chat", "http://offline/api/chat"]);
  });

  test("coerces item ids outside the request candidates to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({
        kind: "action",
        itemId: "github:pr:brocorp/aspex#999",
        actionId: "approve",
      });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("approve it"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "approve it",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces action ids outside the selected action enum to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({
        kind: "action",
        itemId: selectedId,
        actionId: "merge",
      });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("merge it"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "merge it",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces target ids outside the live enum to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({
        kind: "read",
        target: "github:pr:brocorp/aspex#999",
      });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("read that"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "read that",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces select ids outside the live enum to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({
        kind: "nav",
        directive: {
          type: "select",
          id: "github:pr:brocorp/aspex#999",
        },
      });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("select that one"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "select that one",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces second-stage intents to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({
        kind: "confirm",
        itemId: selectedId,
        actionId: "approve",
      });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("confirm approve"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "confirm approve",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces dictation_body intents to no_match", async () => {
    globalThis.fetch = async () =>
      ollamaResponse({ kind: "dictation_body", text: "approve it" });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("approve it"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "approve it",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces post intents to no_match", async () => {
    globalThis.fetch = async () => ollamaResponse({ kind: "post" });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("post it"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "post it",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });

  test("coerces cancel intents to no_match", async () => {
    globalThis.fetch = async () => ollamaResponse({ kind: "cancel" });

    const client = new OllamaIntentService({
      endpoints: ["http://ollama"],
      model: "llama3.1",
      timeoutMs: 100,
    });

    await expect(client.resolve(request("cancel"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "cancel",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });
});

describe("MockIntentService", () => {
  test("returns scripted intents then the default no_match", async () => {
    const scripted: Intent = {
      kind: "action",
      itemId: selectedId,
      actionId: "approve",
    };
    const client = new MockIntentService([scripted]);

    await expect(client.resolve(request("approve it"))).resolves.toEqual({
      intent: scripted,
      source: "freeform",
    });
    await expect(client.resolve(request("something else"))).resolves.toEqual({
      intent: {
        kind: "no_match",
        heard: "something else",
        reason: "unknown_command",
      },
      source: "freeform",
    });
  });
});

function request(text = "approve the selected pr"): IntentRequest {
  return {
    text,
    context: {
      selectedId,
      needsMeIds: [selectedId, otherId],
    },
    candidates: [
      {
        itemId: selectedId,
        summary: "Aspex Card 48 needs approval",
        actions: ["approve", "comment"],
      },
      {
        itemId: otherId,
        summary: "Aspex Card 49 is ready to read",
        actions: ["approve"],
      },
    ],
  };
}

function ollamaResponse(intent: Intent): Response {
  return Response.json({
    message: {
      content: JSON.stringify(intent),
    },
  });
}
