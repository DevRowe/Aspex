import { describe, expect, test } from "bun:test";
import {
  formatLastSeen,
  formatRelativeTime,
  formatStateLiveness,
  reasonAccent,
  reasonLabel,
} from "./format";

describe("format helpers", () => {
  test("maps reason labels used by the inbox", () => {
    expect(reasonLabel.blocked_on_human).toBe("Blocked - needs you");
    expect(reasonLabel.failing_ci).toBe("CI failing");
    expect(reasonLabel.review_requested).toBe("Review requested");
    expect(reasonLabel.awaiting_merge).toBe("Ready to merge");
    expect(reasonLabel.ambient).toBe("");
  });

  test("keeps reason labels free of common encoding corruption", () => {
    const mojibakeMarkers = [
      String.fromCharCode(0xe2),
      String.fromCharCode(0xc2),
    ];

    for (const label of Object.values(reasonLabel)) {
      for (const marker of mojibakeMarkers) {
        expect(label).not.toContain(marker);
      }
    }
  });

  test("groups reasons into calm accents", () => {
    expect(reasonAccent("blocked_on_human")).toBe("warm");
    expect(reasonAccent("failing_ci")).toBe("warm");
    expect(reasonAccent("review_requested")).toBe("neutralPositive");
    expect(reasonAccent("awaiting_merge")).toBe("neutralPositive");
    expect(reasonAccent("ambient")).toBe("muted");
  });

  test("formats relative time without locale variance", () => {
    const now = Date.parse("2026-06-28T02:00:00.000Z");

    expect(formatRelativeTime("2026-06-28T01:59:57.000Z", now)).toBe(
      "just now",
    );
    expect(formatRelativeTime("2026-06-28T01:59:20.000Z", now)).toBe("40s ago");
    expect(formatRelativeTime("2026-06-28T01:15:00.000Z", now)).toBe("45m ago");
    expect(formatRelativeTime("2026-06-27T23:00:00.000Z", now)).toBe("3h ago");
  });

  test("formats state and liveness as an explicit composite", () => {
    expect(formatStateLiveness("working", "stale")).toBe("working - stale");
    expect(formatStateLiveness("done", "live")).toBe("done - live");
    expect(formatStateLiveness("working", "lost")).toBe(
      "working - lost (unconfirmed)",
    );
  });

  test("formats last seen labels with relative time", () => {
    const now = Date.parse("2026-06-28T02:00:00.000Z");

    expect(formatLastSeen("2026-06-28T01:56:00.000Z", now)).toBe(
      "last seen 4m ago",
    );
  });
});
