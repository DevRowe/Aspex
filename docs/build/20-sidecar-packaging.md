# Card 20 — Sidecar packaging (`bun build --compile` → Tauri sidecar)

## Goal
Make the shipped desktop app **one click**: bundle the Hub as a Bun-compiled standalone binary, wire it as a Tauri **sidecar** the app spawns and supervises, and load the UI only once the Hub is healthy (ADR-0008).

## Depends on
- Card 19 (Tauri shell), Card 09 (Hub CLI / `buildHub`).

## Steps

### 1. Compile the Hub to a binary
```bash
bun build apps/hub/src/cli.ts --compile --outfile apps/desktop/src-tauri/binaries/aspex-hub
# Tauri sidecars require the target triple suffix, e.g.:
#   aspex-hub-x86_64-pc-windows-msvc.exe
#   aspex-hub-aarch64-apple-darwin
```
> Confirm the binary runs standalone: `./aspex-hub hub --health-check` style smoke. This is why the Hub had to stay Bun-compile-safe (no Node-native addons; `bun:sqlite` is fine — ADR-0008).

### 2. Declare the sidecar in `tauri.conf.json`
```jsonc
{
  "bundle": { "externalBin": ["binaries/aspex-hub"] }
}
```
Add the `shell`/`process` capability so the app may spawn it (Tauri v2 capabilities file). Scope the permission to **only** this sidecar.

### 3. Spawn + supervise from Rust (`main.rs`)
- On app startup: spawn the `aspex-hub` sidecar (`tauri_plugin_shell` Command::new_sidecar) with a chosen port (pass `--port` / env).
- Poll `GET http://127.0.0.1:<port>/health` until ok (timeout + friendly error window if it never comes up).
- Pass the port to the webview (e.g. via a tiny injected `window.__ASPEX_HUB__` or a Tauri command the JS reads) so `hubClient` connects to the right port.
- On app exit / window close: **kill the sidecar** (no orphaned Hub). Handle the child exiting unexpectedly (show a "Hub stopped" state; offer restart).

### 4. Production launch path
`tauri build` → an installer that contains the UI + the Hub binary. Launching the app starts the Hub automatically; no terminal, no separate process for the user.

## Acceptance check
```bash
cd apps/web && bun run build           # web dist
bun build apps/hub/src/cli.ts --compile --outfile apps/desktop/src-tauri/binaries/aspex-hub-<triple>
cd apps/desktop && bunx tauri build
# launch the built app (not via terminal):
#  - it starts the Hub sidecar itself,
#  - the inbox loads (use a real github token in ~/.aspex/config.json, or run once with mock baked off),
#  - quitting the app leaves NO aspex-hub process running (check task manager / `ps`).
```

## Out of scope / do NOT do
- Do not require the user to start the Hub manually in the packaged app (that was dev-only — ADR-0008).
- Do not leave orphaned Hub processes — supervised lifecycle is the whole point.
- Do not introduce Node-native addons now (would break `--compile`).
- Code signing / notarization / auto-update: later (Phase 4 polish), not here.
