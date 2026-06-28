# Cursor's inbound webhook is an opt-in, bounded exception to poll-first / no-public-ingress

The Hub is **poll-first with no public inbound** (§2.3, ADR-0005): GitHub is polled, claude-code/codex hooks hit `localhost`/the tailnet, the Hub binds `127.0.0.1`. **Cursor breaks this mould.** Its only programmatic signal is a **cloud-origin webhook** (`statusChange`, ERROR/FINISHED only), and it has **no list API**, so polling is impossible and Aspex — which never launches agents — holds no run-ids to poll. To surface cursor's non-PR state we accept a deliberate, **bounded** exception:

- **Opt-in, default off.** `adapters.cursor.enabled` defaults `false`. With it off, the Hub's posture is unchanged.
- **Reuses the generic webhook adapter's inbound plumbing** (card 17); the cursor adapter is a **payload mapping** (`statusChange` → Signal), not a new server.
- **Signature-verified.** Cursor signs its webhooks; the adapter **rejects unsigned / mis-signed POSTs**. (Re-verify the current signing scheme — header + secret — when building.)
- **Exposure is the user's explicit choice.** Aspex **never opens public ingress on its own.** Reaching the webhook from Cursor's cloud requires the user to expose the endpoint (Tailscale Funnel or equivalent); until then the lane is documented and **inert**. This keeps the local-first default intact while making the capability available to those who opt in.
- **Owns only cursor's agent-local state** (ADR-0021); cursor PR work remains the github adapter's.

We rejected **polling** (no list API; Aspex holds no run-ids) and **waiting for a full public-webhook / Funnel subsystem** (out of Phase 3 scope). This bounded, opt-in lane delivers cursor now without committing the Hub to public exposure by default.
