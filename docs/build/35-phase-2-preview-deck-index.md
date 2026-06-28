# Aspex — Phase 2 (Preview Deck) Build Plan (Task Card Index)

Phase 2's **buildable-now** half adds a **Preview Deck** to the flat cockpit: boot a *declared* preview spec in an isolated, disposable container and show it safely. It builds **on top of committed Phase 0 + Phase 1** (cards 01–34): same monorepo, same Hub, same web client, same `AttentionItem` world-model — which it **does not modify**. Build the cards **in order**; later cards depend on earlier ones.

Read this index fully before starting any card. It carries the rules and the canonical preview contract every card assumes. The Phase 0 index (`00-index.md`), the Phase 1 index (`22-phase-1-index.md`), and `../../CONTEXT.md` still apply in full.

> **Scope:** this is the **Preview Deck only** — the hardware-independent track. The **Spatial Shell** (WebXR arc, gaze-dwell, uikit benchmark) stays an outline in `90-later-phases-outline.md`, gated by the **Phase 2 entry gate** (ADR-0009). Nothing here needs a headset.

---

## What the Preview Deck delivers (Definition of Done)

> I declare a preview spec for one of my projects in `~/.aspex` config — an already-built image or compose file, a port, marked `trusted`, optionally bound to an Item. In the cockpit I open the **Deck**, or hit **Preview** on the bound Item, and Aspex boots that spec in a **disposable, `127.0.0.1`-bound container**, then shows the running app in a **cross-origin, sandboxed iframe** with **no access** to the Hub, my token, or the cockpit. The tile shows honest state (`booting → ready → crashed → stopped`). I stop it, or it self-reaps on idle-TTL or Hub shutdown — **never an orphan container**. Aspex **never built, checked out, or computed** anything: it booted what I declared.

The Preview Deck is **opt-in** (`previews.enabled` default `false`) and **Labs/experimental**. The whole broker runs against a **mock engine** with no Docker, so it builds and tests in CI.

**Explicitly NOT in this v1** (see ADRs): the **pixels/neko lane** for untrusted/arbitrary apps (ADR-0016); **adapter-surfaced** specs (ADR-0014 — stubbed extension point); **glTF/USDZ AR-content** previews and any **spatial/WebXR** rendering (those belong to the Spatial Shell track); building/running projects (ADR-0014).

---

## Locked decisions you must not relitigate

Phase 0's ADRs (0001–0008) and Phase 1's (0009–0013) still bind. The Preview Deck adds:

- **ADR-0014** — The Deck **boots declared preview specs; it never builds, checks out, or computes** what to run. v1 specs come from a **local `~/.aspex` registry**; adapter-surfacing is a stubbed [[Provision]]-style extension point.
- **ADR-0015** — A **Preview is ephemeral, not an Item**. Never persisted, ranked, or in needs-me. **Boot is always an explicit user action.** `AttentionItem`/`types.ts` is **unchanged**; previewability is a **client-side cross-reference** of the spec's `itemId`.
- **ADR-0016** — v1 surfaces a **trusted preview in a cross-origin sandboxed iframe** with **zero Hub creds**; the **untrusted pixels/neko lane is deferred**; the `trust` taxonomy is in the model from day one. No postMessage app-protocol in v1.
- **ADR-0017** — Engine is **Docker via the `docker` CLI**, **opt-in & capability-detected** (graceful-degrade if absent), behind a **pluggable `PreviewEngine`** with a **mock**; the **broker is a single Hub subsystem**; lifecycle is **bounded & disposable with no-orphan reaping**.

Use the glossary words exactly (`../../CONTEXT.md` → *Preview Deck (Phase 2)*): Preview Deck, Preview, Preview spec, Preview broker, Preview engine, Trust lane.

---

## Baked-in tech stack (additions to Phase 0/1; do not substitute without an ADR)

| Concern | Choice | Notes |
|---|---|---|
| Container engine | **Docker via the `docker` CLI** (shell out) | no native SDK/addon — Hub stays Bun-compile-safe (ADR-0008). Pluggable `PreviewEngine`. |
| CI / tests | **`bun test`** + **mock engine** | no Docker needed; real Docker verified separately on the dev machine. |
| Surfacing | **cross-origin `sandbox` iframe** (browser) | `http://127.0.0.1:<port>`; no Hub creds; SOP is the primary isolation. |
| Live updates | **existing Hub SSE bus** + new `preview` event | preview state streams like Items do; no polling. |
| Config / registry | **`~/.aspex` config `previews` section** | specs live with the token/DB, outside the repo. |

The Hub stays **single-process** (ADR-0005) and **bound to `127.0.0.1`** (ADR-0005); preview container ports also bind `127.0.0.1`. **No new npm runtime deps** — iframe + `fetch` + SSE already exist; Docker is reached via the CLI, never linked. **No AGPL/GPL** added (update `docs/licenses.md`).

---

## Repository layout (additions)

```
aspex/
  apps/
    hub/
      src/preview/          # NEW: preview broker subsystem
        engine.ts           #   PreviewEngine interface + types
        engineMock.ts       #   mock engine (boot->ready->stop, no Docker)
        engineDocker.ts     #   docker-CLI engine (run/pull/inspect/stop, port alloc, caps)
        registry.ts         #   load + validate PreviewSpec[] from config
        broker.ts           #   lifecycle: boot/track/bound/reap/sweep; crash detection
      src/http/preview.ts   # NEW: /previews REST + SSE 'preview' events (extends card 07)
    web/
      src/preview/          # NEW: Deck panel, preview tiles, sandboxed-iframe render, controls
  packages/
    schema/src/preview.ts   # NEW: PreviewSpec, Preview, PreviewState, PreviewTrust + validators
  docs/
    preview-deck.md         # NEW: canonical spec format + trust lanes + lifecycle + security (card 45)
```

---

## The canonical preview contract (shared types — `packages/schema/src/preview.ts`)

Built in **card 36**. Do not change these shapes without an ADR.

```ts
import type { ItemId } from "./index";

export type PreviewTrust = "trusted" | "untrusted";
export type PreviewState = "booting" | "ready" | "crashed" | "stopped";
export type PreviewEngineKind = "docker" | "compose" | "mock";

// Declared in ~/.aspex config registry (ADR-0014). Aspex boots it; never builds it.
export interface PreviewSpec {
  id: string;                 // stable spec id
  name: string;
  engine: PreviewEngineKind;
  image?: string;             // pull-not-build; exactly one of image/composeFile
  composeFile?: string;
  port: number;               // container port to expose on 127.0.0.1
  trust: PreviewTrust;        // only "trusted" is bootable in v1 (ADR-0016)
  itemId?: ItemId;            // optional binding -> lights the Item's Preview affordance
  env?: Record<string, string>; // NEVER secrets (documented)
  limits?: { cpus?: string; memory?: string; idleTtlSec?: number };
}

// A live booted instance — ephemeral, NOT an Item (ADR-0015).
export interface Preview {
  previewId: string;
  specId: string;
  state: PreviewState;
  trust: PreviewTrust;
  url?: string;               // http://127.0.0.1:<allocated-port> for the iframe (when ready)
  startedAt: string;
  expiresAt?: string;         // idle-TTL deadline
  message?: string;           // crash/error reason, shown honestly
}
```

**HTTP surface (extends card 07's server):**

| Method + path | Purpose |
|---|---|
| `GET /previews/specs` | declared specs (registry), each with `trust` + `itemId` |
| `POST /previews` `{specId}` | **boot** a spec → returns a `Preview` (refused: `untrusted`, unknown spec, or past max-concurrent) |
| `GET /previews` | live previews |
| `GET /previews/:id` | one preview's state/url |
| `DELETE /previews/:id` | explicit teardown |
| SSE `preview` event | `booting → ready → crashed → stopped` streamed on the existing bus |

---

## Lifecycle & security model (every relevant card upholds this)

1. **Boot is explicit & declared.** Only a user action boots, only a registry spec, **pull-not-build**. Missing image → honest error, never an auto-build.
2. **Isolated by origin first.** Render at the container's own `127.0.0.1:<port>` (cross-origin to the cockpit) in a `sandbox` iframe (`allow-scripts allow-forms allow-same-origin`, **withhold** `allow-top-navigation`/`allow-popups`/`allow-modals`), `referrerpolicy="no-referrer"`, `allow=""`. **No Hub credentials cross the boundary**, ever.
3. **Bounded.** Config max-concurrent + per-container CPU/memory caps + idle-TTL. Booting past the cap is refused with a clear message.
4. **Disposable & no-orphan.** `--rm`, recognizable name `aspex-preview-<id>`, no persistent volumes. Reaped on **explicit close, TTL expiry, and Hub shutdown**; a **startup sweep** removes leftover `aspex-preview-*` after a crash.
5. **Crash = visible, not silent.** Unexpected exit → `crashed` state + `message`; **no auto-restart**.
6. **Trusted-only in v1.** `untrusted` specs are registered but not bootable; the Deck says *"pixels lane not yet available."*

---

## Global guardrails (in addition to Phase 0's 8 and Phase 1's 9–13)

14. **Pixels or sandbox, never cockpit code.** A preview's content never executes in the cockpit's origin.
15. **Boot declared specs, never build/compute.** (ADR-0014)
16. **No Hub credentials ever cross into a preview.** (ADR-0016)
17. **Disposable & bounded — no orphan containers; caps enforced.** (ADR-0017)
18. **Mock-first — every broker card passes with no Docker.** (ADR-0017)

---

## Card format

Same as Phase 0/1: **Goal · Depends on · Files · Interfaces/stubs · Steps · Acceptance check (runnable) · Out of scope**. One card per branch/PR.

---

## Preview Deck card list (build in this order)

**Contract**
- `36` — `packages/schema` preview types (`PreviewSpec`, `Preview`, `PreviewState`, `PreviewTrust` + validators)

**Preview engine (pluggable) — mock first**
- `37` — `PreviewEngine` interface + **mock engine** (boot→ready→stop, port stub, no Docker; injectable)
- `38` — **Docker engine** (`docker` CLI: pull/run/inspect/stop, `127.0.0.1` port allocation, `--rm`, name, CPU/mem caps; capability probe)

**Broker (Hub) — pure-ish cores first**
- `39` — Preview **registry** + spec validation (load `previews` config, validate, trust gating, `itemId` binding)
- `40` — Preview **broker / lifecycle** (boot via engine → track state → bound max-concurrent → idle-TTL + shutdown reap + startup sweep → crash detection)
- `41` — Hub **HTTP + SSE** preview endpoints (`/previews/*`, `preview` event; extends card 07)

**Web client**
- `42` — Web **Deck panel + preview tiles** (dedicated route, state-aware tiles, cross-origin sandboxed-iframe render, stop/re-boot/open-in-tab, SSE subscription)
- `43` — Web **Item "Preview" affordance** (client cross-reference of spec list by `itemId` → affordance on Item card → opens Deck focused on that preview)

**Config / ship**
- `44` — Preview **config + CLI** (`previews` config section, `aspex preview check`/`list`; extends card 09)
- `45` — **Docs + threat-model + licenses + CI** (`docs/preview-deck.md`, threat-model Preview Deck section, licenses update, **end-to-end mock boot→ready→stop smoke + no-orphan assertion**)

**After the Preview Deck:** the **Spatial Shell** track + the **Phase 2 entry gate** (ADR-0009) remain outlined in `90-later-phases-outline.md`; the deferred **pixels/neko lane** and **adapter-surfaced specs** are the natural follow-ups to this v1.
