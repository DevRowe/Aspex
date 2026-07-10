import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

// The Hub is reachable from glasses over a private tailnet (ADR-0023), so every
// HTTP/SSE endpoint requires a locally generated bearer token. This is a
// same-machine / same-tailnet credential, not a public auth system.

// Paths that authenticate by their own scheme and are exempt from the bearer.
// The Cursor webhook is reached by Cursor's cloud, which cannot hold the local
// token, so it verifies a per-request HMAC signature instead (ADR-0022).
const BEARER_EXEMPT_PATHS = new Set(["/webhooks/cursor"]);

export function generateHubToken(): string {
  return randomBytes(32).toString("base64url");
}

// Constant-time comparison over fixed-length SHA-256 digests, so mismatched
// lengths neither throw nor leak through timing.
export function timingSafeEqualToken(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function hubAuth(expectedToken: string): MiddlewareHandler {
  return async (c, next) => {
    // CORS preflight carries no credentials; let the cors middleware answer it.
    if (c.req.method === "OPTIONS") {
      return next();
    }

    if (BEARER_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const presented = presentedToken(c);

    if (
      presented === undefined ||
      !timingSafeEqualToken(presented, expectedToken)
    ) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    return next();
  };
}

// Header for most endpoints; `?token=` query parameter for the SSE stream, since
// the browser EventSource API cannot set an Authorization header.
function presentedToken(c: Context): string | undefined {
  const header = c.req.header("authorization");

  if (header !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const value = match?.[1]?.trim();

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  const query = c.req.path === "/stream" ? c.req.query("token") : undefined;

  if (typeof query === "string" && query !== "") {
    return query;
  }

  return undefined;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
