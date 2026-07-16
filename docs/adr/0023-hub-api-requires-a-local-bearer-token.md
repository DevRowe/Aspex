# The Hub API requires a locally generated bearer token

The Hub was built pure-localhost: it binds `127.0.0.1`, and Phase 0 assumed any process that can reach the port is the user (ADR-0005, threat-model "Local-Only Boundary").
That is still the shipped behavior today: the Hub binds `127.0.0.1`, and the browser CORS origin policy is localhost/Tauri-only.
The north-star realignment will break that assumption when glasses reach the Hub **over a private tailnet**, not loopback, so "on the box" will no longer mean "is the user."
Any peer on the tailnet could otherwise read the world-model, dispatch actions, and inject Signals - and the review flagged that the Hub acts with the user's GitHub token for anyone who can hit it.
**Every Hub HTTP/SSE endpoint now requires a locally generated bearer token before the bind-address and origin-policy change lands.**

- **One local token, generated on first boot.** The Hub generates a 256-bit token and persists it to `~/.aspex/config.json` under `auth.token`, or takes one from the `ASPEX_HUB_TOKEN` environment variable, which takes precedence and is never written to disk.
  It is a same-machine credential today and a future same-tailnet credential, not a public authentication system, and there are no accounts, sessions, or rotation policy in this step.
  When an operator supplies `ASPEX_HUB_TOKEN`, they must also provide it to every local caller that should reach the Hub, because the env token is intentionally not persisted for other processes to read.
- **Header for most endpoints, `?token=` for the SSE stream.** Clients send `Authorization: Bearer <token>`.
  The one exception is the SSE stream: the browser `EventSource` API cannot set request headers, so the stream also accepts the token as a `?token=` query parameter.
  This is a deliberate tradeoff - a query-string token can leak into logs and referrers - accepted because the surface is local today and intended for private-tailnet use later, and it is the only way an `EventSource` client can authenticate without a bespoke polyfill.
- **Constant-time comparison, fail closed.** The presented token is compared against the configured one over fixed-length SHA-256 digests, so a mismatched length neither throws nor leaks through timing.
  A missing or wrong token is a `401`; no endpoint is reachable without it.
- **CORS origin policy stays local.** The token is checked after the existing CORS middleware, so preflight `OPTIONS` (which carries no credentials) still succeeds.
  The allowed origins remain localhost/Tauri-only in this step.
- **The Cursor webhook keeps its own auth.** `POST /webhooks/cursor` is exempt from the bearer because it is reached by Cursor's cloud, which cannot hold the local token; it already verifies a per-request HMAC signature and fails closed without a secret (ADR-0022).
  It is the one deliberate bearer exemption.
- **Local callers present the token too.** The bundled `aspex hook-relay` (Claude Code / Codex Signals) and the `aspex preview list` CLI read the token from config and send it, so protecting `/signals` and the rest does not break same-box ingestion.

We rejected **waiting to add auth until the bind opens** (the tailnet is the whole point of the target topology, and adding the token first prevents a wide-open API the moment remote reachability lands), **mTLS or an OAuth/session system** (real infrastructure and UX for a single-user local tool - over-built for the threat, and reversible later if a genuine multi-user need appears), and **exempting `/health`** (a tailnet peer reading version and liveness would be a small but needless leak once the bind opens; uniform enforcement is simpler to reason about).
The cost is that every client - including the forthcoming AR clients and the legacy desktop cockpit - must carry the token.
The retained desktop shell and web client do that through the Tauri `hub_token` command and browser `Authorization` headers, even though the cockpit remains a legacy surface rather than the north-star client.

**Amendment (2026-07-17).** Both first-party clients now stream over fetch-based SSE (`eventsource-parser`) and send `Authorization: Bearer` on the stream too.
The `?token=` query parameter remains accepted but is deprecated: it survives only as the escape hatch for native `EventSource` clients, and its removal is deferred until after the owner's on-device wear test.
