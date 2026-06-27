# Card 17 — `adapter-webhook` (generic local ingest)

## Goal
A catch-all ingest so **any** local tool that can POST JSON can surface an Item — a CI script, a cron job, another agent runner. Local inbound only (no public ingress — poll-first per the plan).

## Depends on
- Card 07 (`POST /signals/webhook`), Card 08 (registry).

## Files to create
```
packages/adapter-webhook/package.json
packages/adapter-webhook/src/index.ts     # WebhookAdapter
packages/adapter-webhook/test/webhook.test.ts
```

## Behaviour
- The Hub already accepts `POST /signals/webhook` (card 07). This adapter:
  - Provides `listActions`/`runAction` (Phase 0: actions `[]`, `runAction` returns a benign no-op or a configured `ackUrl` callback if the body included one — keep minimal: `[]` + read-only).
  - Defines the **accepted body shape** and normalisation: minimal `{ key, summary, state?, severity?, attentionRequired?, evidence? }` → Item `id = webhook:<key>`, `source: "webhook"`, sensible defaults (`state: "needs_review"` if attention, else `"working"`, `reason` left to ownership/engine → mostly Ambient unless attentionRequired).
  - A POST with the same `key` **upserts** the same Item (ADR-0001).
- Document the contract in `docs/adapter-authoring.md` (card 21).

## Acceptance check
```bash
bun test packages/adapter-webhook   # green
# live:
curl -X POST http://127.0.0.1:4317/signals/webhook -H 'content-type: application/json' \
  -d '{"id":"webhook:deploy-1","source":"webhook","state":"error","summary":"Deploy failed","attentionRequired":true,"severity":"high"}'
curl -s http://127.0.0.1:4317/state | jq '.needsMe[] | select(.id=="webhook:deploy-1")'
```
Tests prove: a minimal body normalises to a valid Item; same `key` twice → one Item; attentionRequired body lands in needs-me, ambient body does not.

## Out of scope / do NOT do
- **No public ingress.** Bind stays `127.0.0.1` (Tailscale Funnel is a later phase). No auth in Phase 0.
- Do not invent rich action semantics — generic ingest is read-mostly.
