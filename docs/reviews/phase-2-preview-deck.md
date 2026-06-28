# Phase 2 — Preview Deck Review

**Date:** 2026-06-28
**Reviewer:** Claude (Opus 4.8)
**Scope:** The full Preview Deck build (cards 35–45 — container-isolated ephemeral previews on the flat cockpit) against the plan, ADRs 0014–0017, the `CONTEXT.md` *Preview Deck (Phase 2)* glossary, `docs/preview-deck.md`, and the `docs/threat-model.md` Preview Deck section. The hardware-gated Spatial Shell remains an outline and is out of scope.

## Verdict

**Faithful, high-quality build — the flat Preview Deck is complete and the isolation model holds.** All four Preview-Deck ADRs are honored in the code, not just the tests: the broker boots only *declared, trusted* specs and never builds or computes; a Preview is a purely in-memory, disposable concept that never touches the world-model (`AttentionItem` is byte-for-byte unchanged); trusted previews render in a cross-origin, sandboxed iframe with zero Hub credentials; Docker is reached over the CLI as an opt-in, capability-detected, pluggable engine with a mock that keeps the whole subsystem CI-testable with no Docker. Three findings were fixed in this pass and the gates re-run: a missing regression guard on the security-critical iframe attributes; the idle-TTL reaper had no periodic tick (only lazy on-access sweeping); and a pre-existing **cross-platform bug** in the Phase 0 claude-code adapter that failed CI on Linux. The two things a static review can't cover are a real `docker` round-trip and the packaged-Tauri webview — see Residuals.

## Method

Static read of every load-bearing Preview file — the schema contract (`packages/schema/src/preview.ts`), the engine interface + mock + Docker engine (`engine.ts`, `engineMock.ts`, `engineDocker.ts`), the registry (`registry.ts`), the broker/lifecycle (`broker.ts`), the HTTP + SSE route (`http/preview.ts`), the Hub wiring (`boot.ts`, `http/server.ts`, `sse.ts`, `bus.ts`, `config.ts`, `cli.ts`), and the web layer (`usePreviews.ts`, `Deck.tsx`, `PreviewTile.tsx`, `previewClient.ts`, `specsByItem.ts`, and the `ItemDetail`/`Inbox`/`App`/`hubClient` integration) — plus the objective gates, a trace of the cardinal invariants through the boot/teardown path, and the shipped docs (`preview-deck.md`, threat-model, licenses).

## Objective gates

| Check | Result |
|---|---|
| `bun test` | **266 pass / 0 fail** across 38 files (was 190/27 at Phase 1), incl. the post-fix iframe-contract + periodic-sweep tests |
| `bun run typecheck` | clean across all 9 Bun packages (web included; the new files are in the explicit typecheck list) |
| `bun run lint` (Biome) | clean, 134 files |
| Dependency discipline | Preview Deck adds **no npm runtime dependency** (iframe + `fetch` + the existing SSE stream); the Hub shells out to the `docker` CLI via `Bun.spawn` — no Docker SDK, no native addon (Bun-compile-safe, ADR-0008). `docs/licenses.md` updated; no AGPL/GPL |
| Local-first posture | Hub still binds `127.0.0.1`; preview container ports also bind `127.0.0.1`; CORS allowlist excludes the `127.0.0.1:<port>` preview origin; no cloud, no telemetry |
| World-model integrity | `packages/schema/src/types.ts` is **unchanged** (`git diff` empty) — no `preview` field on `AttentionItem`; previews live only in the broker's in-memory map |

## ADR adherence

| ADR | Decision | Status |
|---|---|---|
| 0014 | Boots **declared** specs, never builds/computes | ✅ Specs come from the `~/.aspex` config registry (`loadPreviewRegistry`); `engineDocker` only `pull`/`run`/`compose up` — there is **no `docker build`** and no branch/worktree/CLI inference anywhere. Adapter-surfacing is absent by design (no Phase 0 adapter touched) — the stubbed [[Provision]] extension point |
| 0015 | A Preview is ephemeral, not an Item; world-model untouched | ✅ `types.ts` unchanged; the broker holds `Preview` records in a `Map`, never SQLite/world; emits on a separate `preview` bus event; the client shows previewability by cross-referencing `specsByItem` (no Item mutation); boot is explicit (`POST /previews` only, no auto-boot). The Deck UI even states "Disposable previews stay outside the world-model" |
| 0016 | Trusted cross-origin sandboxed iframe; pixels lane deferred; trust taxonomy in model | ✅ `PreviewTile` renders the iframe **only** when `ready && trusted && url`, with `sandbox="allow-scripts allow-forms allow-same-origin"`, `referrerPolicy="no-referrer"`, `allow=""`, and no credential in `src`; `untrusted` specs are refused at the broker (`403`) and shown non-bootable in the Deck; no postMessage protocol; pixels/neko deferred |
| 0017 | Docker via CLI, opt-in/detected, pluggable + mock, single-subsystem, bounded/no-orphan | ✅ `previews.enabled` default **false**; `engine.available()` gates with graceful-degrade (`preparePreviews` warns + disables routes); `Bun.spawn(["docker", …])`, no SDK; pluggable `PreviewEngine` + `createMockEngine`; broker is one Hub subsystem; `maxConcurrent`/cpu/memory/idle-TTL bounds; `--rm` + `aspex-preview-*` naming + startup `sweep()` + `shutdown()` reap; crash → `crashed`, no restart |

## Grilled-scenario verification (traced through the boot/teardown path)

The cardinal Preview-Deck guarantee is the **isolation + disposability funnel**: a Preview can only ever be a declared, trusted, container-bounded, credential-free, reap-on-everything surface that never enters the world-model. Verified:

- **Only declared, trusted specs boot.** `broker.boot` funnels through `lookupSpec` (unknown → throws → `404`) → trust gate (`!== "trusted"` → throws → `403`) → cap gate (`activeCount() >= maxConcurrent` → throws → `429`) **before** any container is created; the cap-check→`createRecord` step is synchronous (no `await` between), so concurrent boots cannot overshoot the cap. The engine only pulls/runs — never builds.
- **The monitoring layer is untouched.** No code path writes a Preview to the store or the world-model; `AttentionItem` gains no field; the `state` SSE path is unchanged and previews ride a *separate* `preview` event.
- **No credentials cross the boundary.** The iframe `src` is the bare `127.0.0.1:<port>`; no token/cookie is injected; the Hub's CORS allowlist (`tauri://localhost` / `http://localhost:*`) excludes the preview origin, so even a hostile preview can't browser-call the Hub.
- **No orphans.** Containers are `--rm`, named `aspex-preview-<id>`, reaped on explicit stop, idle-TTL, and `shutdown()`; a stop *during* boot tears down the late-arriving container; a startup `sweep()` clears `aspex-preview-*` containers (and compose networks) after a crash.
- **Crash is honest.** Unexpected `docker wait`/compose-poll exit flips the Preview to `crashed` with a message and is **not** auto-restarted.

These are backed by `broker.test.ts` (untrusted reject, "too many previews open" cap, idle-TTL reap via an injected clock, crash-without-restart, shutdown-stops-all-and-clears-cap), `http.test.ts` (`201`/`403`/`404`/`429`/`204` + stop-race `404`), the `e2e-mock.test.ts` end-to-end (boot → SSE `ready` → `403`/`429` refusals → `204` stop → SSE `stopped`), `engineMock`/`engineDocker`/`registry`/schema `preview` tests, and the web `previewClient`/`specsByItem`/`iframeSandbox` tests.

## Smoke / end-to-end (mock)

- **Full Preview loop** is exercised headlessly by `e2e-mock.test.ts` against the real Hono app + broker + **mock engine** (no Docker) — the mock-first acceptance from card 45 — asserting the SSE transitions and the refusal codes.
- **HTTP surface** maps broker outcomes to `201/403/404/429/204` and emits `preview` SSE events on the existing stream.
- `aspex preview check` probes engine availability + validates the registry and reports each spec as bootable / not-bootable (untrusted) / not-bootable (engine unavailable); `aspex preview list` reads the running Hub's `/previews`.

## Findings & resolutions

1. **The security-critical iframe attributes had no regression guard.** The ADR-0016 isolation contract — the `sandbox`/`referrerPolicy`/`allow` attributes and the trusted-only render gate — is the single most important surface in the feature, but it was rendered from inline string literals in `PreviewTile` with **no test**, and the web package has no DOM-render harness (consistent with Phase 0/1, which never render-tested components). Card 42's acceptance explicitly required asserting the sandbox attributes and that no Hub credential reaches the iframe. **Fixed:** extracted the attributes into `apps/web/src/preview/iframeSandbox.ts` (with a security-rationale comment) consumed by `PreviewTile`, and added `iframeSandbox.test.ts` asserting the minimal grant set (`allow-scripts`/`allow-forms`/`allow-same-origin`), the withheld escalation tokens (`allow-top-navigation`/`allow-popups`/`allow-modals`/…), `no-referrer`, and empty `allow` — a pure test in the project's existing style, no new dependency. Both files were added to the web typecheck list.

2. **Idle-TTL was enforced lazily, not on a timer.** ADR-0017 and card 40 specify "an idle TTL after which the broker auto-reaps" / "a single timer loop," but the broker only swept expired previews when `boot`/`get`/`list` was next called — and the client relies on SSE *push* after its initial load, so an idle Hub with a forgotten `ready` Preview would keep that container running past `idleTtlSec` until the next preview API call (shutdown still reaped everything, so no cross-lifetime orphan). **Fixed:** added a public `broker.sweep()` (exposing the already-tested `sweepExpired`) and a `.unref()`'d `setInterval` in the Hub's `start()` that calls it every 15 s, cleared in `stop()` — mirroring the existing `LivenessTicker` lifecycle. The lazy on-access sweep stays as a backstop. New test `broker.test.ts › sweep() reaps expired ready previews on its own` proves the periodic path reaps without any `boot`/`get`/`list` call. The lifecycle docs (`preview-deck.md`, threat-model) now describe a reality that matches the code.

3. **A pre-existing cross-platform bug failed CI on Linux** (surfaced when the branch was pushed). `packages/adapter-claude-code/src/index.ts` derived an Item's `project` from the agent's `cwd` via `node:path`'s `basename`, which is platform-specific: on Windows it splits on `\`, on Linux it does not — so a Windows `cwd` like `D:\BroCorp\Aspex` mapped to `project = "D:\BroCorp\Aspex"` on a Linux host instead of `"Aspex"`, failing `map.test.ts › Notification maps to a blocked needs-me item …`. This is a genuine bug (a Windows agent's path on a Linux Hub — e.g. the GPU box — would mis-label the project), not just a test issue. **Fixed:** replaced `basename(cwd)` with a `projectFromCwd` helper that splits on **both** separators (`/[\\/]+/`) regardless of host OS, so Windows and POSIX cwds both resolve correctly everywhere. The existing Windows-path and POSIX-path tests now pass on every platform.

After fixes: `bun test` **266 pass / 0 fail** (38 files), typecheck clean (9 packages), lint clean (134 files).

## Residual / not covered by a static review

- **No real Docker round-trip.** `engineDocker.ts` is unit-tested with an injected command runner, but no actual `docker` pull → run → `127.0.0.1` ready → stop → sweep was executed — Docker-gated by design (card 38), the Preview-Deck analogue of Phase 1's unrun real-model voice smoke. Run a one-off with a tiny image (e.g. `nginx:alpine`) when convenient.
- **The Deck is a gated panel inside `Inbox`, not a separate route.** Card 42 said "dedicated Deck panel/route"; the app has no router, so it renders as a `previewsEnabled`-gated `<Deck/>` section below needs-me. The conceptual separation (disposable, outside the world-model) is preserved and stated in the UI copy. Acceptable; revisit when routing arrives.
- **Packaged-Tauri webview framing** of `http://127.0.0.1:<port>` (custom scheme + CSP/mixed-content) is unverified — the documented verify-later caveat from ADR-0016, same family as the long-outstanding Phase 0/1 Tauri release-build residuals.
- **Minor:** `mapStopError`'s `404` branch in `http/preview.ts` is effectively dead (the `DELETE` route pre-checks existence before calling `stop`) — harmless. Preview `env` is passed to Docker via `-e` on argv (visible in a process list); within card scope and documented "no secrets in env," but `--env-file` would be tidier if secrets ever entered the picture.
