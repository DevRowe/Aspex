# Hub API protocol v1.1

The Hub's HTTP+SSE surface is the one contract every Aspex client shares (glasses, phone companions, the Giles-side consumer).
This document is authoritative for the protocol v1.1 conventions layered onto the routes; the routes themselves are defined by `apps/hub/src/http/server.ts` and the orchestrator design report (giles task `aspex-protocol-design-d1`).
Auth is unchanged and documented in ADR-0023: every endpoint requires `Authorization: Bearer <token>` (SSE also accepts `?token=` for native `EventSource`).

## Versioning and forward compatibility

`GET /state` advertises `apiVersion` (currently `"1.1"`).
There is no `/v1` path prefix; the protocol evolves additively.
Two client rules make that work:

- Ignore JSON fields you do not recognize.
- Ignore SSE event types you do not recognize.

A client must never fail because a new field or event type appeared.

## Error bodies: RFC 9457 problem+json

Every error response has `Content-Type: application/problem+json` and an RFC 9457 body: `type`, `title`, `status`, `detail`, plus extensions.
Every problem also carries a legacy `message` extension (equal to `detail`) for pre-v1.1 clients; new clients should read `detail`.

Generic errors use `type: "about:blank"`; branch on `status` and `title` if you must, but prefer treating them as opaque failures.
Conditions a client is expected to branch on get a named type URI (a `urn:aspex:problem:*` URN; deliberately not dereferenceable):

| Type | Status | Meaning |
| --- | --- | --- |
| `urn:aspex:problem:confirmation-required` | 409 | The action or dispatch needs a confirmed retry (see below). |
| `urn:aspex:problem:idempotency-key-mismatch` | 400 | `Idempotency-Key` header and body `intentId` disagree. |
| `urn:aspex:problem:same-key-different-payload` | 422 | An intent id was reused with a different payload. |

### The confirmation gate

Consequential verbs keep the two-step 409-until-confirmed gate (the kept decision from the AR-platforms report, Decision 1): the first call without `confirmed: true` is refused with 409, and the client re-sends after the user approves.
The 409 body is the machine-readable bridge:

```json
{
  "type": "urn:aspex:problem:confirmation-required",
  "title": "Action requires confirmation",
  "status": 409,
  "detail": "Action requires confirmation: Confirm Review & ship on orchestrator:giles:fix-auth-d2",
  "message": "Action requires confirmation: ...",
  "itemId": "orchestrator:giles:fix-auth-d2",
  "actionId": "ship",
  "summary": "Confirm Review & ship on orchestrator:giles:fix-auth-d2",
  "resend": { "payload": { "mergeWord": "merge" }, "intentId": "a-1", "confirmed": true }
}
```

`summary` is what the client restates to the user; `resend` is the exact JSON body to POST back to the same URL once approved.
On `POST /intents` the extensions are `verb`, `intentId`, `orchestrator`, `summary`, and `resend` (the intent with `confirmed: true`).
If the gate ever migrates to a 202 + pending-approval resource, this problem type disappears and clients that branch on it fail loudly instead of silently.

## Idempotency

Direction intents are deduplicated by a client-generated intent id (design 2.6).
Protocol v1.1 aligns the surface with the IETF `Idempotency-Key` header draft while keeping the body `intentId` as the domain id (it names the orchestrator inbox file):

- The key may arrive as the body `intentId`, as an `Idempotency-Key` header (bare or quoted), or both; when both are present they must agree (else 400 `idempotency-key-mismatch`).
  Keys use the intent-id alphabet: 1-128 characters of `[A-Za-z0-9._-]`, no leading dot.
- A retry with the same key and the same payload replays the recorded response and sets `Idempotency-Replayed: true`; a concurrent duplicate joins the in-flight request (same marker) instead of racing it.
- The same key with a different payload is refused with 422 `same-key-different-payload`.
  Payload comparison is a stored key-order-insensitive fingerprint of the request, so re-serialization is safe but any content change is a conflict.
- Only successful outcomes (dispatched actions, accepted dispatches) are recorded; failures stay retryable with the same key.
- **Retention window**: the ledger is a capacity-bounded LRU of 1024 intents per Hub process, not a time window.
  Replay is guaranteed only while the entry has not been evicted and the Hub has not restarted; the orchestrator inbox filename (the intent id) is the durable backstop that makes a re-executed delivery still deduplicate end to end.

## SSE stream (`GET /stream`)

Frames on the stream:

- `state` - the full ranked snapshot (same shape as `GET /state`); sent on connect and on every world change.
- `ping` - keepalive every 15 s, `data: {}`; carries no `id:` and is not replayable. Ignore it (or use it for liveness).
- Unknown event types may appear in future versions; ignore them.

Resumability (the same mechanism MCP's Streamable HTTP transport builds on):

- Every `state` event carries a monotonically increasing `id:`.
- The server sends `retry: 3000` on connect; honor it for reconnect backoff.
- On reconnect, send `Last-Event-ID` (native `EventSource` does this automatically).
  If the id is still inside the Hub's bounded replay ring (256 events), you receive exactly the missed events and no snapshot; otherwise you receive a fresh `state` snapshot stamped with the current id.
  Either way the stream is consistent after the first frame - clients need no special resume logic.
- Ids are seeded from the Hub's boot time, so an id from a previous run never lands inside the new run's range; a stale id from a previous run safely falls back to the fresh snapshot.

## TLS on the tailnet exposure

Snap requires `wss`/`https` to publish a client, Meta's web-app path expects secure origins, and Chrome 142+ Local Network Access prompts secure pages that fetch plain-http local addresses.
The Hub therefore supports optional TLS, designed for the tailnet topology (ADR-0023):

```jsonc
// ~/.aspex/config.json
{
  "hubBind": "100.99.1.2",
  "tls": {
    "certPath": "~/.aspex/hub.crt",
    "keyPath": "~/.aspex/hub.key"
  }
}
```

Or `ASPEX_HUB_TLS_CERT` / `ASPEX_HUB_TLS_KEY`.
With `tls` set the Hub serves `https://` (and `wss`-capable SSE) on the same port; both PEM files are read at boot and a missing file fails fast with the path.

Cert provisioning is manual, by design; the pragmatic paths:

1. **`tailscale cert <machine>.<tailnet>.ts.net`** - a publicly valid Let's Encrypt cert for the machine's tailnet DNS name; point `tls` at the emitted pair and have clients dial the `ts.net` name. Renewal is re-running the command (cron it); the Hub must be restarted to pick up a renewed cert.
2. **`tailscale serve https / http://127.0.0.1:4317`** - Tailscale terminates TLS in front of a loopback Hub; no Hub `tls` config needed. Prefer this when the tailscale daemon is already managing the box.
3. Any other PEM pair (an internal CA, mkcert for a lab) works; browser trust is then the operator's problem.

What remains manual: certificate renewal/rotation (no auto-reload), and choosing a client-resolvable name that matches the cert.
Loopback development stays plain http; do not add TLS there.

## Client checklist

A conforming v1.1 client:

- sends `Authorization: Bearer` (or `?token=` for native EventSource);
- reads `detail` from problem+json errors and branches on `type` for the table above;
- generates an intent id per logical operation, resends the same id on retry, and treats `Idempotency-Replayed: true` as success;
- lets `EventSource` (or its fetch-SSE equivalent) handle `id:`/`retry:`/`Last-Event-ID`;
- ignores unknown JSON fields and unknown SSE event types.
