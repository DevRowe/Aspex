import { afterEach, describe, expect, test } from "bun:test";
import type { AttentionItem, VoiceResult } from "@aspex/schema";
import { useStore } from "../store";
import { useVoiceStore } from "../voice/voiceStore";
import {
  applyIntentResult,
  buildIntentContext,
  isIntentEnabled,
  postIntent,
} from "./useIntent";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  useStore.setState({
    needsMe: [],
    overflow: [],
    ambient: [],
    generatedAt: "",
    connected: false,
    selectedId: null,
  });
  useVoiceStore.setState({
    phase: "idle",
    lastReadback: null,
    lastOk: null,
    session: {},
    error: null,
    enabled: true,
  });
});

describe("intent client", () => {
  test("posts text with the current selected id and visible needs-me ids", async () => {
    let request: Request | undefined;
    const result: VoiceResult = {
      ok: true,
      readback: "Showing what needs you.",
      directive: { type: "show_needs_me" },
      session: {},
    };

    useStore.setState({
      needsMe: [item("github:pr:1"), item("codex:session:2")],
      overflow: [item("github:pr:overflow")],
      ambient: [],
      generatedAt: "2026-06-28T00:00:00.000Z",
      selectedId: "codex:session:2",
    });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json(result));
    }) as typeof fetch;

    const response = await postIntent("what needs me", buildIntentContext());

    expect(response).toEqual(result);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("http://127.0.0.1:4317/intent");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.json()).toEqual({
      text: "what needs me",
      context: {
        selectedId: "codex:session:2",
        needsMeIds: ["github:pr:1", "codex:session:2"],
      },
    });
  });

  test("applies readback session and directive through the existing voice flow", () => {
    useStore.setState({
      needsMe: [item("github:pr:1"), item("codex:session:2")],
      overflow: [],
      ambient: [],
      generatedAt: "2026-06-28T00:00:00.000Z",
      selectedId: "github:pr:1",
    });

    applyIntentResult({
      ok: true,
      readback: "Selected codex.",
      directive: { type: "select", id: "codex:session:2" },
      session: {},
    });

    expect(useVoiceStore.getState().phase).toBe("result");
    expect(useVoiceStore.getState().lastReadback).toBe("Selected codex.");
    expect(useVoiceStore.getState().lastOk).toBe(true);
    expect(useStore.getState().selectedId).toBe("codex:session:2");
  });

  test("armed results mirror the pending confirm session for the existing prompt", () => {
    applyIntentResult({
      ok: true,
      readback: "I read that as: approve atlas. Say confirm approve.",
      directive: { type: "none" },
      session: {
        pendingConfirm: {
          itemId: "github:pr:1",
          actionId: "approve",
          label: "Approve",
          armedAt: "2026-06-28T00:00:00.000Z",
        },
      },
    });

    expect(useVoiceStore.getState().session.pendingConfirm).toEqual({
      itemId: "github:pr:1",
      actionId: "approve",
      label: "Approve",
      armedAt: "2026-06-28T00:00:00.000Z",
    });
    expect(useVoiceStore.getState().lastReadback).toContain("I read that as");
  });

  test("voice disabled does not change typed intent submission or result apply", async () => {
    let body: unknown;
    const result: VoiceResult = {
      ok: true,
      readback: "Done.",
      directive: { type: "none" },
      session: {},
    };

    useVoiceStore.setState({ enabled: false });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      body = request.json();
      return Promise.resolve(Response.json(result));
    }) as typeof fetch;

    const response = await postIntent("confirm approve", buildIntentContext());
    applyIntentResult(response);

    expect(await body).toEqual({
      text: "confirm approve",
      context: { needsMeIds: [] },
    });
    expect(useVoiceStore.getState().enabled).toBe(false);
    expect(useVoiceStore.getState().lastReadback).toBe("Done.");
  });

  test("intent visibility is hidden only by an explicit false config flag", () => {
    expect(isIntentEnabled(undefined)).toBe(true);
    expect(isIntentEnabled({})).toBe(true);
    expect(isIntentEnabled({ intent: {} })).toBe(true);
    expect(isIntentEnabled({ intentEnabled: false })).toBe(false);
    expect(isIntentEnabled({ intent: { enabled: false } })).toBe(false);
  });
});

function item(id: string): AttentionItem {
  return {
    id,
    source: "github",
    project: "aspex",
    state: "needs_review",
    liveness: "live",
    reason: "review_requested",
    attentionRequired: true,
    severity: "medium",
    summary: id,
    evidence: [],
    actions: [],
    observedAt: "2026-06-28T00:00:00.000Z",
    staleAfter: "2026-06-28T00:05:00.000Z",
  };
}
