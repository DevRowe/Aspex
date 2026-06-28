# Phase 0 Review

**Date:** 2026-06-28
**Reviewer:** Claude (Opus 4.8)
**Scope:** The full Phase 0 build (cards 01–21) against the plan, the 8 ADRs, and `CONTEXT.md`.

## Verdict

**Faithful, high-quality build — ship-ready for the releasable flat core.** All 8 ADRs are honored in the code (not just the tests), the `AttentionItem` contract and priority ladder match `docs/build/00-index.md`, the security boundary holds, and both live smoke tests pass. The three findings below were all minor and have been fixed.

## Method

Static read of every load-bearing file (schema, store, attention engine, liveness, world-model, registry, HTTP server, CLI, both heavy adapters, Tauri shell + `main.rs`, web action/confirm flow), plus the objective gates and two live end-to-end smoke tests.

## Objective gates

| Check | Result |
|---|---|
| `bun test` | **101 pass / 0 fail** across 18 files |
| `bun run typecheck` | clean across all 9 packages |
| `bun run lint` (Biome) | clean, 86 files |
| Dependency discipline | Hub = `hono` only (no NATS/Socket.IO/Express); storage = `bun:sqlite` (no ORM/native addon — Bun-compile-safe); github = `@octokit/rest`; schema = zero deps |
| Ship artifacts | Apache-2.0 `LICENSE`, `NOTICE`, threat-model, event-schema, adapter-authoring, `licenses.md` (asserts no AGPL/GPL), CI all present |

## ADR adherence

| ADR | Decision | Status |
|---|---|---|
| 0001 | Upsert Items by id, not events | ✅ `INSERT … ON CONFLICT(id) DO UPDATE`; one row per id |
| 0002 | Attention partitioned by lifecycle | ✅ `enforceOwnership` sends claude-code `done`/`working`→ambient; github owns review/CI/merge |
| 0003 | Two-track liveness; terminal never decays | ✅ poll-health vs heartbeat grace; `PostToolUse`→`heartbeat:true`→per-session `applyHeartbeat` preserves `blocked` state (after fix: `error` is terminal too — see Findings) |
| 0004 | claude-code read-only; github two-way; no PTY | ✅ `runAction`→"read-only in Phase 0"; `listActions`→`[]`; zero PTY/`child_process`/`eval` in code |
| 0005 | Single-process Hub, SSE+REST+SQLite | ✅ Hono SSE/REST, `bun:sqlite`, in-proc `Bus`; binds `127.0.0.1` only |
| 0006 | Viewer-centric github search | ✅ `review-requested:@me`/`author:@me`/`assignee:@me` + allowlist; dedup to one record per PR; ETag/304 |
| 0007 | Tauri desktop shell first-class | ✅ Tauri v2, strict CSP (`connect-src` local Hub only), sidecar via `externalBin` |
| 0008 | Dev separate, release Bun sidecar | ✅ `cfg(not(debug_assertions))` gates the sidecar; health-gated startup; kills child on exit (no orphan) |

## Grilled-scenario verification (in code)

- **One card per PR on the highest rung:** `map.ts` classifies `failing_ci` first while keeping already-accumulated review actions → a review-requested + CI-red PR is **one Item, `failing_ci`, carrying both approve + re-run actions**.
- **Finished session → Ambient:** `Stop`→`done`/`ambient`/`attentionRequired:false`, with `enforceOwnership` as a clamp.
- **Healthy long run stays live:** `PostToolUse` heartbeat refreshes `staleAfter` without flipping `state`.
- **Dangerous action two-step:** `ConfirmGate` requires typing the confirm word before POSTing `confirmed:true`; server returns 409 otherwise.

## Live smoke tests

**1. claude-code hooks (end-to-end, temp `CLAUDE_CONFIG_DIR`, real CLI/relay/HTTP):**
`hooks install` wired all four hooks → `Notification` produced a `blocked`/`blocked_on_human` Item in needs-me → `PostToolUse` produced a `working`/`live` Item in ambient → `Stop` moved the blocked session out of needs-me to `ambient`/`done` → `hooks uninstall` restored `settings.json` to `{}`. ✅

**2. github (live API, real `repo`-scoped token, not printed):**
First poll against the live API succeeded (`discovered 1 GitHub pull requests`); the authored PR `DevRowe/gatsby-starter-spectral#1` classified **ambient** (open PR, not review-requested / CI-red / ready-to-merge → correctly not needs-me). Auth, viewer-centric search, classification, mapping, and `/state` all work end-to-end. ✅

## Findings & resolutions

1. **`error` was not terminal in liveness** (deviated from ADR-0003). The build treated only `done` as terminal, so an errored session decayed to `stale`/`lost`. **Fixed:** `TERMINAL = {"done","error"}`. Rationale: a session ends in `done` (success) or `error` (failure) — both are confirmed-final, expect no further heartbeats, and must stay `live`; only in-flight `working`/`blocked` decay. Terminal-ness (liveness axis) is orthogonal to `attentionRequired` (ADR-0002), so an Item can be `error · live · needs-me`. Test flipped to assert the new behavior.
2. **Transient `heartbeat` flag could persist** into an Item created on a first `PostToolUse`. **Fixed:** the flag is stripped in `WorldModel.applyHeartbeat` before persistence (it is transport-only, not part of the schema).
3. **Mock demo-data drift** vs the real github adapter (approve marked `safe`; awaiting-merge item `state:"done"`). **Fixed:** `script.json` now mirrors the adapter (approve = `medium`/confirm; awaiting-merge = `needs_review`).

After fixes: 101 pass / 0 fail, typecheck and lint clean.

## Residual / not covered by a static review

- The **Tauri release build** (`bun build --compile` → `tauri build`) was not executed (needs the Rust toolchain; the ADR-0008 dev path does not require it). The Rust/config reads correct; a one-off packaged-build smoke is still worth doing before any distribution.
- Worth noting (not a defect): the github adapter's **first poll runs during `hub.start()`**, so Hub readiness/`/health` is gated on that first live call. Fine for a fast token; could be made non-blocking later if startup latency matters.
