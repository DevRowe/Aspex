# Card 54 — `adapter-codex` (observe-only, notify/hook-relay-fed)

## Goal
Surface **codex** sessions via Codex's `notify` program → the existing **`aspex hook-relay`** → `POST /signals/codex` (ADR-0021), the same pattern as claude-code (card 16). **Observe + deep-link only**; agent-local attention; mock-first. Includes an `aspex codex install/uninstall` helper that writes the `notify` entry into Codex's config idempotently.

## Depends on
- Card 02 (`Adapter`, `Signal`), Card 07 (`POST /signals/:source` → `applySignal`), Card 16 (the `hook-relay` command — reuse/extend it for a `--source codex`), Card 09 (CLI slots).

## Files to create / edit
```
packages/adapter-codex/package.json
packages/adapter-codex/src/index.ts          # CodexAdapter (listActions []; runAction refuse; stop)
packages/adapter-codex/src/map.ts             # pure: codex notify JSON -> Signal | heartbeat
packages/adapter-codex/src/notify-install.ts  # write/remove the `notify` entry in Codex config (idempotent)
packages/adapter-codex/test/map.test.ts
packages/adapter-codex/test/install.test.ts
packages/adapter-codex/test/fixtures/*.json   # recorded codex notify payloads
# edit packages/adapter-claude-code/src/relay.ts (or a shared relay) to accept --source codex
```

## Ingestion
Codex's `notify` config runs an external program with a **single JSON argument** on supported events (currently **`agent-turn-complete`**; fields include `type`, `thread-id`). Point it at the relay:
```
# Codex config (e.g. ~/.codex/config.toml)
notify = ["aspex", "hook-relay", "--source", "codex"]
```
The relay reads codex's JSON (from argv/stdin), shapes a `Signal` (id `codex:session:<thread-id>`, source `codex`), and POSTs to `/signals/codex` — short timeout, **exit fast and never error** (don't break the user's codex), exactly like the claude-code relay.

## Event → Signal mapping (`map.ts`, pure)
> **Honest coarseness:** codex `notify` currently fires only `agent-turn-complete`, so codex Items update **per completed turn**, not mid-turn. Richer `blocked`/`error` states await codex exposing more notify events (the `--json`/app-server path would require Aspex to *launch* codex — out of scope, ADR-0021/not-an-orchestrator). Map what exists:

| codex event | Item | State / Reason |
|---|---|---|
| `agent-turn-complete` | `codex:session:<thread-id>` | `state: done`, **Ambient** (attentionRequired **false**, ADR-0002) + heartbeat; `deepLink` to the session/cwd |
| (future) needs-approval / error events | same | map to `blocked`/`error` + attentionRequired when codex emits them |

So v1 codex surfaces **liveness + Ambient turn-completions + a deep-link** — visible on demand, not in needs-me. Documented as such (card 58).

## `Adapter` surface
- `listActions` → `[]`; `runAction` → `{ ok:false, message:"codex is observe-only in Phase 3" }` (ADR-0021).
- `aspex codex install` / `uninstall`: read Codex config, **idempotently** add/remove the `notify` entry (match by the `aspex hook-relay` command; back up first; don't touch other keys) — mirror `aspex hooks install` (card 16).

## Acceptance check
```bash
bun test packages/adapter-codex   # green
```
Tests must prove (against **fixtures**, no real codex):
- An `agent-turn-complete` payload → a `codex:session:<id>` Item, `state: done`, Ambient, attentionRequired **false**, `deepLink` set, `actions: []`.
- The same thread-id twice → one upserted Item (ADR-0001).
- The relay never throws on a malformed payload (exits 0 quietly).
- `codex install` then `uninstall` round-trips the config exactly and is idempotent on double-install.
- `runAction` returns the observe-only refusal.

## Out of scope / do NOT do
- **No PTY / no control / no launching codex** (ADR-0021). Deep-link only.
- Do **not** claim PR-lifecycle attention — codex PRs are **github**'s (ADR-0002).
- Do not invent `blocked`/`error` mappings codex doesn't actually emit — map only real events; document the coarseness honestly.
- The relay must never block or error the user's codex (same rule as claude-code).
- Do not register the adapter here — wiring is card 57.
