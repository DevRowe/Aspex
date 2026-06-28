# The preview engine is Docker via the CLI — opt-in, capability-detected, pluggable, mock-first; the broker is a Hub subsystem

Container-per-boot needs an engine. v1 uses **Docker**, but with a deliberate stance that protects the local-first core and CI:

- **Opt-in, off by default.** `previews.enabled` defaults to `false`, the same posture as `voice.enabled`. The Preview Deck never affects the Phase 0/1 core when off.
- **Docker is a detected, optional capability — never a hard dependency.** The broker probes for a working `docker` CLI; if absent, the Deck disables itself with an honest message and the Hub runs fine. Requiring Docker Desktop of every user would raise the floor on a Labs feature and break low-friction local-first.
- **The broker shells out to the `docker` CLI — no native Docker SDK/addon** — keeping the Hub Bun-compile-safe (ADR-0008), the same reason the voice gateway uses HTTP, not native libs.
- **Pluggable behind a `PreviewEngine` interface**, Docker as the v1 implementation, with **E2B / microsandbox as future engines** behind the same seam ([[Provision]]-style), and a **mock engine** so every broker card passes with **no Docker, in CI** (mock-first, exactly like the mock STT/TTS). Real Docker is verified separately on the developer's machine and never gates CI.
- **The broker is a single Hub subsystem** (analogue of the voice gateway), preserving the single-process Hub of ADR-0005; it just spawns and reaps child containers via the CLI.

Lifecycle is **bounded and disposable**: explicit boot only, **pull-not-build**, a configurable max-concurrent plus per-container CPU/memory caps and an idle TTL, and **every container the broker spawned is reaped on explicit close, TTL expiry, and Hub shutdown**, with `--rm` and a startup sweep of leftover `aspex-preview-*` containers as belt-and-braces — **no orphan containers** (the Preview analogue of the Phase 0 sidecar "no orphan process" guarantee). A container that exits unexpectedly flips the Preview to `crashed` and is **not** auto-restarted (disposable, not supervised).

We rejected a required Docker dependency (breaks local-first for a Labs feature) and a native Docker SDK (breaks Bun-compile, ADR-0008); without the mock engine the feature could not be tested in CI, violating the Phase 0/1 mock-first invariant.
