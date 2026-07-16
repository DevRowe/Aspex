import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";

// RFC 9457 Problem Details: every Hub error body is application/problem+json
// so agent clients branch on the `type` URI instead of parsing prose
// (protocol v1.1, docs/hub-api.md). Generic errors use "about:blank" per
// RFC 9457 section 4.2.1; only conditions a client must branch on get a
// named urn:aspex:problem:* type. Every problem keeps the legacy `message`
// extension so pre-v1.1 clients that read `body.message` keep working.

export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=UTF-8";

// The named problem types of protocol v1.1. The URN is the stable machine
// contract; it is deliberately not dereferenceable.
export const PROBLEM_TYPES = {
  confirmationRequired: "urn:aspex:problem:confirmation-required",
  idempotencyKeyMismatch: "urn:aspex:problem:idempotency-key-mismatch",
  sameKeyDifferentPayload: "urn:aspex:problem:same-key-different-payload",
} as const;

export interface ProblemInit {
  status: number;
  title: string;
  // A urn:aspex:problem:* URI; omitted means the generic "about:blank".
  type?: string;
  detail?: string;
  extensions?: Record<string, unknown>;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  // Legacy prose field predating problem+json; clients should prefer detail.
  message: string;
  [extension: string]: unknown;
}

export function problemBody(init: ProblemInit): ProblemBody {
  const detail = init.detail ?? init.title;

  return {
    type: init.type ?? "about:blank",
    title: init.title,
    status: init.status,
    detail,
    message: detail,
    ...init.extensions,
  };
}

export function problem(c: Context, init: ProblemInit): Response {
  return problemResponse(c, problemBody(init));
}

export function problemResponse(
  c: Context,
  body: ProblemBody,
  headers?: Record<string, string>,
): Response {
  return c.newResponse(JSON.stringify(body), body.status as StatusCode, {
    "Content-Type": PROBLEM_CONTENT_TYPE,
    ...headers,
  });
}

// Recognizes a problem body coming back out of the intent ledger, so a
// replayed or in-flight-joined entry is re-sent with the problem media type.
export function isProblemBody(body: unknown): body is ProblemBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).type === "string" &&
    typeof (body as Record<string, unknown>).title === "string" &&
    typeof (body as Record<string, unknown>).status === "number"
  );
}
