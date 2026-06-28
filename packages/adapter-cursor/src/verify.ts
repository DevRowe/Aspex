import { createHmac, timingSafeEqual } from "node:crypto";

export const CURSOR_SIGNATURE_HEADER = "x-cursor-signature";

export interface CursorSignatureInput {
  secret?: string;
  rawBody: string | Uint8Array;
  signature?: string | null;
}

export function verifyCursorSignature(input: CursorSignatureInput): boolean {
  const secret = input.secret?.trim();
  const signature = parseSignature(input.signature);

  if (secret === undefined || secret.length === 0 || signature === null) {
    return false;
  }

  const expected = hmac(input.rawBody, secret);

  if (signature.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(signature, expected);
}

export function signCursorBody(
  rawBody: string | Uint8Array,
  secret: string,
): string {
  return hmac(rawBody, secret).toString("hex");
}

function hmac(rawBody: string | Uint8Array, secret: string): Buffer {
  return createHmac("sha256", secret).update(rawBody).digest();
}

function parseSignature(signature: string | null | undefined): Buffer | null {
  if (signature === null || signature === undefined) {
    return null;
  }

  const trimmed = signature.trim();
  const hex = trimmed.startsWith("sha256=")
    ? trimmed.slice("sha256=".length)
    : trimmed;

  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    return null;
  }

  return Buffer.from(hex, "hex");
}
