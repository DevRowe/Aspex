import { describe, expect, test } from "bun:test";
import { signCursorBody, verifyCursorSignature } from "../src";
import errorFixture from "./fixtures/error-status-change.json";

const secret = "cursor-test-secret";
const rawBody = JSON.stringify(errorFixture);
const fixtureSignature = await Bun.file(
  new URL("./fixtures/error-status-change.sha256", import.meta.url),
).text();

describe("verifyCursorSignature", () => {
  test("accepts the documented x-cursor-signature hex sha256 HMAC", () => {
    expect(
      verifyCursorSignature({
        secret,
        rawBody,
        signature: fixtureSignature.trim(),
      }),
    ).toBe(true);
  });

  test("accepts sha256-prefixed signatures", () => {
    const signature = `sha256=${signCursorBody(rawBody, secret)}`;

    expect(verifyCursorSignature({ secret, rawBody, signature })).toBe(true);
  });

  test("fails closed when the secret is missing", () => {
    const signature = signCursorBody(rawBody, secret);

    expect(verifyCursorSignature({ rawBody, signature })).toBe(false);
  });

  test("rejects missing, malformed, or mismatched signatures", () => {
    expect(
      verifyCursorSignature({ secret, rawBody, signature: undefined }),
    ).toBe(false);
    expect(
      verifyCursorSignature({ secret, rawBody, signature: "not-hex" }),
    ).toBe(false);
    expect(
      verifyCursorSignature({
        secret,
        rawBody,
        signature: signCursorBody(`${rawBody}\n`, secret),
      }),
    ).toBe(false);
  });
});
