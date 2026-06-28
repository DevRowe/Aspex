import { describe, expect, test } from "bun:test";
import {
  TRUSTED_PREVIEW_ALLOW,
  TRUSTED_PREVIEW_REFERRER_POLICY,
  TRUSTED_PREVIEW_SANDBOX,
} from "./iframeSandbox";

const tokens = TRUSTED_PREVIEW_SANDBOX.split(/\s+/).filter(
  (token) => token.length > 0,
);

describe("trusted Preview iframe contract (ADR-0016)", () => {
  test("grants only the minimal tokens a first-party app needs", () => {
    expect(tokens).toContain("allow-scripts");
    expect(tokens).toContain("allow-forms");
    expect(tokens).toContain("allow-same-origin");
  });

  test("withholds every privilege-escalation token", () => {
    for (const forbidden of [
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-top-navigation-to-custom-protocols",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-modals",
      "allow-downloads",
      "allow-pointer-lock",
      "allow-presentation",
      "allow-orientation-lock",
    ]) {
      expect(tokens).not.toContain(forbidden);
    }
  });

  test("leaks no referrer and delegates no powerful features", () => {
    expect(TRUSTED_PREVIEW_REFERRER_POLICY).toBe("no-referrer");
    expect(TRUSTED_PREVIEW_ALLOW).toBe("");
  });
});
