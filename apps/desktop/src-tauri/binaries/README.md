# Tauri sidecar binaries

This directory holds the Hub sidecar that the desktop shell spawns
(`externalBin: ["binaries/aspex-hub"]` in `tauri.conf.json`, per ADR-0008).

**These binaries are build artifacts and are not committed.**
They are produced from the Hub with `bun build --compile` and named with the
Rust target triple Tauri expects, for example
`aspex-hub-x86_64-pc-windows-msvc.exe` or `aspex-hub-aarch64-apple-darwin`.
The release/packaging step regenerates them for each target; nothing in the repo
should depend on a checked-in copy.

Everything in this directory except this file is gitignored.
A ~95 MB Windows sidecar was previously committed here by mistake; it has been
removed from the tip.
Rewriting it out of history is a separate, owner-approved operation and has not
been done.
