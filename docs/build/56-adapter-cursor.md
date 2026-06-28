# Card 56 — `adapter-cursor` (opt-in, signed inbound webhook)

## Goal
Surface **cursor** background agents via an **opt-in, signature-verified inbound webhook** (`statusChange`) → Signal (ADR-0022). Observe + deep-link only; agent-local attention; **default off**; reuses the generic webhook plumbing (card 17). The Hub is **never auto-exposed** — reaching this from Cursor's cloud is the user's deliberate choice (Tailscale Funnel); until then the lane is inert.

## Depends on
- Card 02 (`Adapter`, `Signal`), Card 07/17 (the inbound-signal plumbing + `POST /signals/*`), Card 09 (config).

## Files to create / edit
```
packages/adapter-cursor/package.json
packages/adapter-cursor/src/index.ts        # CursorAdapter (listActions []; runAction refuse)
packages/adapter-cursor/src/map.ts           # pure: statusChange -> Signal
packages/adapter-cursor/src/verify.ts         # signature verification (HMAC over the raw body)
packages/adapter-cursor/test/map.test.ts
packages/adapter-cursor/test/verify.test.ts
packages/adapter-cursor/test/fixtures/*.json  # recorded statusChange payloads (+ signatures)
# edit apps/hub/src/http/server.ts            # mount POST /webhooks/cursor ONLY when adapters.cursor.enabled
```

## Endpoint
| Method | Path | Purpose |
|---|---|---|
| POST | `/webhooks/cursor` | **mounted only when `adapters.cursor.enabled`**. Verify the signature over the **raw** body (reject → `401`, no Item). On valid: map `statusChange` → Signal. When disabled, the route is **absent** (404). |

## Signature verification (`verify.ts`)
> **Re-verify Cursor's current scheme when building** — the header name + HMAC algorithm + which bytes are signed. Implement: read the configured `secret`, compute the HMAC over the **raw request body**, constant-time compare against the signature header. Reject unsigned/mismatched with `401`. No secret configured → the route refuses (`401`) even if `enabled` (fail-closed).

## Event → Signal mapping (`map.ts`, pure)
Cursor sends `statusChange` for **ERROR / FINISHED** only.

| statusChange | Item | State / Reason |
|---|---|---|
| `ERROR` | `cursor:agent:<id>` | `state: error`, `reason: error`, attentionRequired, `deepLink` (cursor agent/PR url) |
| `FINISHED` | `cursor:agent:<id>` | `state: done`, **Ambient** (the PR, if any, is **github**'s — ADR-0002) |

So cursor surfaces **ERROR as needs-me** and **FINISHED as Ambient** + a deep-link.

## `Adapter` surface
- `listActions` → `[]`; `runAction` → `{ ok:false, message:"cursor is observe-only in Phase 3" }` (ADR-0021).

## Acceptance check
```bash
bun test packages/adapter-cursor   # green
```
Tests must prove (against **fixtures**, no real cursor cloud):
- A **valid-signed** `ERROR` payload → a `cursor:agent:<id>` Item, `state: error`, attentionRequired true, `deepLink` set.
- A **valid-signed** `FINISHED` payload → `state: done`, Ambient, attentionRequired **false** (ADR-0002).
- An **invalid/missing signature** → `401`, **no Item** created.
- With `adapters.cursor.enabled` false → `POST /webhooks/cursor` is **not mounted** (404).
- `runAction` returns the observe-only refusal.

## Out of scope / do NOT do
- **No control** (ADR-0021); deep-link only.
- **No auto-exposure / no Funnel subsystem.** The Hub binds `127.0.0.1`; the user exposes the endpoint deliberately. Document the ingress caveat (card 58); do **not** bind `0.0.0.0`.
- **No polling** — Cursor has no list API, and Aspex launches nothing (ADR-0022). Webhook only.
- Do not claim PR-lifecycle attention — cursor PRs are **github**'s.
- Default **off**; never mount the route or accept POSTs when disabled.
