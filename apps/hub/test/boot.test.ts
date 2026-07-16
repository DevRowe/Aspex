import { describe, expect, test } from "bun:test";
import { signCursorBody } from "@aspex/adapter-cursor";
import { buildHub } from "../src/boot";
import { DEFAULT_CONFIG } from "../src/config";

describe("hub boot", () => {
  test("registers the mock adapter only when mock mode is enabled", async () => {
    const normalHub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });
    const mockHub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      mock: true,
    });

    try {
      await normalHub.start();
      await mockHub.start();

      await expect(
        normalHub.registry.dispatchAction(
          "github:pr:brocorp/aspex#101",
          "approve",
        ),
      ).resolves.toEqual({ ok: false, message: "No adapter for item source" });
      await expect(
        mockHub.registry.dispatchAction(
          "github:pr:brocorp/aspex#101",
          "approve",
        ),
      ).resolves.toEqual({ ok: true, message: "mock action" });
    } finally {
      await normalHub.stop();
      await mockHub.stop();
    }
  });

  test("leaves new agent adapters and cursor webhook disabled by default", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await expect(
        hub.registry.dispatchAction("codex:session:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "No adapter for item source",
      });
      await expect(
        hub.registry.dispatchAction("opencode:session:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "No adapter for item source",
      });
      await expect(
        hub.registry.dispatchAction("cursor:agent:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "No adapter for item source",
      });

      const cursorWebhook = await hub.app.fetch(
        signedCursorRequest(
          { statusChange: "ERROR", agentId: "abc" },
          "secret",
        ),
      );
      expect(cursorWebhook.status).toBe(404);
    } finally {
      await hub.stop();
    }
  });

  test("enabled agent adapters are registered and cursor webhook is mounted", async () => {
    const secret = "cursor-secret";
    const hub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      adapters: {
        codex: { enabled: true },
        opencode: {
          enabled: true,
          serverUrl: "http://127.0.0.1:4096",
        },
        cursor: { enabled: true, secret },
      },
    });

    try {
      await expect(
        hub.registry.dispatchAction("codex:session:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "codex is observe-only in Phase 3",
      });
      await expect(
        hub.registry.dispatchAction("opencode:session:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "opencode is observe-only in Phase 3",
      });
      await expect(
        hub.registry.dispatchAction("cursor:agent:abc", "reply"),
      ).resolves.toEqual({
        ok: false,
        message: "cursor is observe-only in Phase 3",
      });

      const cursorWebhook = await hub.app.fetch(
        signedCursorRequest(
          {
            statusChange: "ERROR",
            agentId: "abc",
            project: "aspex",
          },
          secret,
        ),
      );
      expect(cursorWebhook.status).toBe(202);
      expect(hub.world.snapshot()[0]).toMatchObject({
        id: "cursor:agent:abc",
        source: "cursor",
        state: "error",
        reason: "errored",
        attentionRequired: true,
      });
    } finally {
      await hub.stop();
    }
  });

  test("enforces the configured auth token across endpoints", async () => {
    const hub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      auth: { token: "boot-token" },
    });

    try {
      await hub.start();

      const unauth = await hub.app.fetch(new Request("http://hub.test/state"));
      const authed = await hub.app.fetch(
        new Request("http://hub.test/state", {
          headers: { authorization: "Bearer boot-token" },
        }),
      );

      expect(unauth.status).toBe(401);
      expect(authed.status).toBe(200);
    } finally {
      await hub.stop();
    }
  });

  test("intent-only config builds text gateway without enabling voice", async () => {
    const hub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      intent: {
        enabled: true,
        mock: true,
        endpoints: [],
        model: "llama3.1",
        timeoutMs: 8000,
        elevateConfirm: true,
      },
    });

    try {
      await hub.start();

      const config = await hub.app.fetch(new Request("http://hub.test/config"));
      const intent = await hub.app.fetch(
        new Request("http://hub.test/intent", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aspex-voice-session": "boot-intent-test-1",
            "x-aspex-voice-generation": "1",
          },
          body: JSON.stringify({
            text: "what needs me",
            context: { needsMeIds: [] },
          }),
        }),
      );
      const form = new FormData();
      form.set("audio", new File([new Uint8Array([1])], "utterance.wav"));
      form.set("context", JSON.stringify({ needsMeIds: [] }));
      const utterance = await hub.app.fetch(
        new Request("http://hub.test/voice/utterance", {
          method: "POST",
          body: form,
        }),
      );

      expect(await config.json()).toMatchObject({
        voice: { enabled: false },
        intentEnabled: true,
        intent: { enabled: true },
      });
      expect(intent.status).toBe(200);
      expect(await intent.json()).toMatchObject({
        ok: true,
        readback: "Nothing needs you right now.",
      });
      expect(utterance.status).toBe(503);
      expect(await utterance.json()).toMatchObject({
        error: "voice not configured",
      });
    } finally {
      await hub.stop();
    }
  });

  test("does not build intent gateway when voice and intent are disabled", async () => {
    const hub = buildHub({ ...DEFAULT_CONFIG, dbPath: ":memory:" });

    try {
      await hub.start();

      const config = await hub.app.fetch(new Request("http://hub.test/config"));
      const intent = await hub.app.fetch(
        new Request("http://hub.test/intent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: "what needs me",
            context: { needsMeIds: [] },
          }),
        }),
      );

      expect(await config.json()).toMatchObject({
        intentEnabled: false,
        intent: { enabled: false },
      });
      expect(intent.status).toBe(503);
      expect(await intent.json()).toMatchObject({
        error: "intent not configured",
      });
    } finally {
      await hub.stop();
    }
  });

  test("voice enabled does not opt in the intent route", async () => {
    const hub = buildHub({
      ...DEFAULT_CONFIG,
      dbPath: ":memory:",
      voice: {
        enabled: true,
        mock: true,
        stt: {
          endpoints: ["http://127.0.0.1:8901/transcribe"],
          timeoutMs: 5000,
        },
        tts: {},
        confidenceThreshold: 0.6,
        confirmTtlMs: 8000,
        pttKey: "Space",
      },
      intent: {
        enabled: false,
        endpoints: ["http://127.0.0.1:11434"],
        model: "llama3.1",
        timeoutMs: 8000,
        elevateConfirm: true,
      },
    });

    try {
      await hub.start();

      const intent = await hub.app.fetch(
        new Request("http://hub.test/intent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: "what needs me",
            context: { needsMeIds: [] },
          }),
        }),
      );

      expect(intent.status).toBe(503);
      expect(await intent.json()).toMatchObject({
        error: "intent not configured",
      });
    } finally {
      await hub.stop();
    }
  });
});

function signedCursorRequest(payload: unknown, signingSecret: string): Request {
  const rawBody = JSON.stringify(payload);

  return new Request("http://hub.test/webhooks/cursor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cursor-signature": signCursorBody(rawBody, signingSecret),
    },
    body: rawBody,
  });
}
