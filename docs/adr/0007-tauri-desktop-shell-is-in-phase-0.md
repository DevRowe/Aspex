# Tauri desktop/DeX shell is a first-class Phase 0 target

The flat cockpit ships inside a Tauri desktop app from Phase 0, not as a deferred packaging step over a browser-based web app. Desktop / Samsung DeX is a core part of the product vision ("flat-screen/DeX core today"), so the desktop shell is treated as first-class from the start rather than retrofitted later.

This is a deliberate choice to accept the Rust/Tauri toolchain and native-build complexity on the critical path in exchange for the real desktop/DeX form factor early and no later re-platforming of the shell. Consequence for the chunked build plan: it must include explicit Tauri setup chunks (toolchain install, `tauri.conf`, dev vs build commands, the Hub-process lifecycle relative to the Tauri app) and the React UI is authored as a Tauri-hosted webview talking to the local Hub, not a standalone browser tab. The SSE + REST Hub interface (ADR-0005) is unchanged — Tauri's webview consumes it the same way a browser would.
