# Aspex — Session Handoff

*Resume point for the next agent. Last updated 2026-06-28.*

## recap — what just happened

This session took Aspex from a build plan to a **reviewed, committed Phase 0**.

1. **Grilled** the source plan (`C:\Users\johnl\Downloads\Aspex-Build-Plan-v2.md`) → wrote the glossary (`CONTEXT.md`), 8 ADRs (`docs/adr/`), and a chunked Phase 0 build plan (`docs/build/` — index + 21 task cards + later-phases outline).
2. **Workers built** all 21 Phase 0 cards (one commit each).
3. **Reviewed** the build against the plan — read every load-bearing file, ran the gates, fixed 3 minor nits, ran 2 live smoke tests. Full write-up in [`docs/reviews/phase-0.md`](reviews/phase-0.md).

## state — where things stand

- **Phase 0 is built, reviewed, and green.** `bun test` → 101 pass / 0 fail; `bun run typecheck` and `bun run lint` clean.
- **Both live smoke tests pass:** claude-code hooks end-to-end (install → blocked → ambient → uninstall); github live poll with a real token (auth → search → classify → `/state`).
- **Git:** branch `main`. Latest commits:
  - `ed839b4` docs: add phase-0 review
  - `22861ef` fix: address phase-0 review nits
  - `87a8272` …workers' card 01–21 build, on top of the planning commit `5b84938`.
  - **No git remote configured; nothing pushed.** (Awaiting the name decision — see Open items.)
- **No Tauri release build has been run** (needs Rust toolchain). The dev path (separate Hub + `tauri dev`) is the only one exercised.

## decisions (the locked ADRs — do not relitigate)

| ADR | Decision |
|---|---|
| 0001 | World-model = current-state **Items upserted by id**, not events |
| 0002 | Attention **partitioned by lifecycle** (per-agent owns blocked/error; github owns review/CI/merge); no double-glow |
| 0003 | **Two-track liveness** (poll-health vs heartbeats); terminal states never decay — `done` **and `error`** (fixed this session) |
| 0004 | Phase 0 claude-code is **read-only** (deep-link, no PTY); github two-way |
| 0005 | **Single-process Hub**: in-proc bus, SSE + REST, SQLite; no NATS/Socket.IO |
| 0006 | github discovery = **viewer-centric search**, not repo enumeration |
| 0007 | **Tauri desktop shell** is first-class in Phase 0 |
| 0008 | Hub↔Tauri: **dev separate, release Bun-compiled sidecar** |

Stack (locked): Bun (runtime + pm + compiler), TypeScript, Hono, `bun:sqlite`, `@octokit/rest`, React/Vite/Tailwind/Zustand, Tauri v2, Biome.

## next move (pick up here)

Two candidates, user has not yet chosen:
1. **Tauri packaged release-build smoke** — `bun build --compile` the Hub → `tauri build` → launch the packaged app, confirm it auto-starts the Hub sidecar and leaves no orphan process. This is the one Phase-0 path a static review couldn't cover. Needs the Rust toolchain installed.
2. **Scope Phase 1 (voice)** — run another grill pass. **Hard gate first:** verify mic capture works inside a live `immersive-ar` WebXR session on the real target hardware *before* any spatial work (the plan flags this as unreliable on some runtimes).

## standing action items (from the plan, not phase-gated)

1. **Clear the name** *Aspex/Auspex* and grab the GitHub org + a `.dev`/`.app` domain — blocks pushing to a remote.
2. Apply to Google's **Android XR Developer Catalyst Program** (free target hardware).
3. Plan an **XREAL Aura grey-import to Perth**.
4. **Re-verify Claude Code subscription/billing** before relying on the PTY path (deferred from Phase 0).
5. Get **R&D tax advice** before banking on the 43.5% — most of Phase 0 is routine dev.

## gotchas for the next agent

- **Bun is not on the Bash PATH.** Use PowerShell with `$env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"`, or call `~/.bun/bin/bun` directly in Bash.
- **PowerShell wraps native stderr in red** when you pipe `2>&1` — that's a rendering artifact, *not* a failure (check the exit code / `pass`-count instead).
- **Never print GitHub token bytes** — the auto-mode classifier blocks it. Pass the token to the Hub via `ASPEX_GITHUB_TOKEN="$(gh auth token)"` inline (env only, never echoed). `gh` is authed as **DevRowe** (`repo` scope).
- **github adapter's first poll blocks `hub.start()`/`/health`** — readiness waits on the first live API call. Fine for a fast token.
- **Token/secret hygiene:** Hub config and DB default to `~/.aspex/` (outside the repo), so the token isn't committed. Keep it there; don't drop an `aspex.config.json` at the repo root (the committed `.gitignore` is minimal).
- To run the Hub for a quick check: `bun run apps/hub/src/cli.ts hub --mock` then `curl 127.0.0.1:4317/state`. `--mock` needs no token/agents.
