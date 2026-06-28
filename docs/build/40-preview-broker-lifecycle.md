# Card 40 — Preview broker / lifecycle

## Goal
The orchestrator that turns a boot request into a tracked, bounded, disposable Preview and guarantees **no orphan containers**. It boots a validated spec through the injected `PreviewEngine`, tracks live `Preview` state in memory, enforces the bounds (max-concurrent, idle-TTL), detects crashes, and reaps everything on close / TTL / Hub shutdown — plus a startup sweep. Pure-ish: all I/O is behind the engine interface, so it tests fully against the **mock engine, no Docker** (ADR-0017).

## Depends on
- Card 36 (`Preview`, `PreviewSpec`, `PreviewState`), Card 37 (`PreviewEngine` interface + mock), Card 39 (registry: validated specs + `trust` gating + lookup by id).

## Files to create
```
apps/hub/src/preview/broker.ts
```

## Interfaces / stubs (fill in)
```ts
import type { Preview, PreviewSpec } from "@aspex/schema";
import type { PreviewEngine } from "./engine";

export interface BrokerConfig {
  maxConcurrent: number;          // refuse boot past this
  defaultIdleTtlSec: number;      // spec.limits.idleTtlSec overrides
}

export interface PreviewBroker {
  boot(specId: string): Promise<Preview>;     // explicit, declared, trusted-only
  stop(previewId: string): Promise<void>;     // explicit teardown
  get(previewId: string): Preview | undefined;
  list(): Preview[];
  shutdown(): Promise<void>;                  // reap ALL spawned containers
  // emits state changes for the SSE layer (card 41)
  onChange(cb: (p: Preview) => void): () => void;
}

export function createPreviewBroker(args: {
  engine: PreviewEngine;
  lookupSpec: (specId: string) => PreviewSpec | undefined;  // from registry (card 39)
  config: BrokerConfig;
  now?: () => number;             // injectable clock for tests
}): PreviewBroker;
```

## Behaviour
- **boot(specId):**
  1. Look up the spec (registry). Unknown → reject with a clear error.
  2. **Trust gate:** `spec.trust !== "trusted"` → reject (`"pixels lane not yet available"`) — ADR-0016.
  3. **Cap gate:** live count ≥ `maxConcurrent` → reject (`"too many previews open"`).
  4. Create a `Preview` `{ previewId, specId, state: "booting", trust, startedAt }`, store it, **emit**.
  5. Call `engine.boot(spec)`; on success set `state: "ready"`, `url`, `expiresAt = now + idleTtl`, emit. On engine failure set `state: "crashed"`, `message`, emit; ensure no container leaks.
- **Idle-TTL:** a single timer loop (driven by `now()`) reaps previews past `expiresAt` → `engine.stop` → `state: "stopped"`, emit, drop from the live set.
- **Crash detection:** subscribe to `engine`'s exit signal (card 37 exposes it); unexpected exit → `state: "crashed"`, `message`, emit; **no auto-restart**.
- **stop(previewId):** `engine.stop` → `state: "stopped"`, emit, drop.
- **shutdown():** stop every live preview (best-effort, parallel), so **nothing the broker spawned outlives the Hub** (the no-orphan guarantee). The Docker engine additionally sweeps `aspex-preview-*` at startup (card 38) — the broker just guarantees its own tracked set is reaped here.
- All container I/O goes through `engine`; the broker never shells out itself.

## Steps
1. In-memory `Map<previewId, Preview>` + a change-emitter (`onChange`/emit).
2. `boot` with the three gates (unknown / trust / cap) → engine boot → ready/crashed transitions.
3. Idle-TTL reaper using injected `now()` (test with a fake clock — no real timers in unit tests).
4. Crash subscription → `crashed` state.
5. `stop` + `shutdown` (reap-all).
6. Tests in `apps/hub/test/preview/broker.test.ts` against the **mock engine**: happy path booting→ready; untrusted rejected; cap rejected; idle-TTL reaps (fake clock); crash → crashed (no restart); `shutdown` stops all; `onChange` fires for every transition.

## Acceptance check
```
cd apps/hub && bun test test/preview/broker.test.ts
```
Expected: all broker cases pass with the **mock engine and no Docker**. `bun run typecheck` + `bun run lint` clean.

## Out of scope / do NOT do
- No Docker, no shelling out — that lives entirely in the engine (cards 37/38). The broker is engine-agnostic and must pass on the mock.
- No HTTP/SSE wiring (card 41) — expose `onChange`/`list`/`get`; the endpoint layer adapts it.
- No build/checkout/compute of anything (ADR-0014) — boot only.
- Do not persist previews to SQLite or the world-model (ADR-0015 — ephemeral, in-memory only).
- Do not auto-boot, auto-restart, or queue past the cap — reject explicitly (guardrails 15/17).
