# Card 19 — Tauri shell `apps/desktop` (dev: hosts the web build)

## Goal
Wrap the web UI in a Tauri v2 desktop app (ADR-0007). In **dev**, the Tauri webview loads the Vite dev server (or built web) and talks to a **separately-run** Hub on localhost (ADR-0008 — sidecar bundling is the next card).

## Depends on
- Card 11–14 (a working web UI), a running `aspex hub`.

## Prerequisites (install once)
- Rust toolchain (`rustup`), and the Tauri v2 system deps for your OS (WebView2 is built into Windows 11).
- `bun add -d @tauri-apps/cli` (workspace) — invoke via `bunx tauri`.

## Files to create
```
apps/desktop/src-tauri/tauri.conf.json
apps/desktop/src-tauri/Cargo.toml
apps/desktop/src-tauri/src/main.rs       # minimal: just run the app
apps/desktop/package.json                # scripts: "dev": "tauri dev", "build": "tauri build"
```

## Key config (`tauri.conf.json`)
- `build.devUrl` = `http://localhost:5173` (the Vite dev server).
- `build.frontendDist` = the built web output (`../../web/dist`) for `tauri build`.
- `app.windows[0]`: title "Aspex", reasonable size, `decorations: true`.
- CSP: restrict to self + the local Hub origin (`http://127.0.0.1:4317` / `connect-src`). This enforces the "no remote code" boundary at the shell.
- `app.security.dangerousRemoteDomainIpcAccess`: leave OFF.

## Steps
1. `bunx tauri init` inside `apps/desktop` (or hand-create the files).
2. Point `devUrl` at the Vite server; set window config + CSP.
3. `main.rs` stays the Tauri default (no custom commands yet — the UI talks HTTP to the Hub, not via Tauri IPC, keeping the web/Tauri code identical to the browser path).

## Acceptance check
```bash
# terminal 1: bun run apps/hub/src/cli.ts hub --mock
# terminal 2: cd apps/web && bun run dev
# terminal 3: cd apps/desktop && bunx tauri dev
# -> a native Aspex window opens showing the inbox with live mock data.
```

## Out of scope / do NOT do
- **No Hub sidecar bundling yet** (card 20) — Hub runs separately in dev (ADR-0008).
- Do not move Hub logic into Rust (the Hub stays Node/TS — the plan's architecture).
- Do not add Tauri IPC commands for data — the UI uses HTTP/SSE so it stays identical to the browser build.
- Keep CSP strict; do not allow arbitrary remote origins (security boundary).
