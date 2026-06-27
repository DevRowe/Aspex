import { describe, expect, test } from "bun:test";
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
});
