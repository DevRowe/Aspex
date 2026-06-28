# Card 37 — `PreviewEngine` interface + mock engine

## Goal
Define the pluggable `PreviewEngine` seam every engine implements, and a **mock engine** that boots without Docker. The mock is what makes the broker (card 40) and the whole Deck testable in CI (ADR-0017, mock-first). The broker holds the returned handle and never shells out itself.

## Depends on
- Card 36 (`PreviewSpec`, `PreviewEngineKind`).

## Files to create
```
apps/hub/src/preview/engine.ts       # interface + handle types
apps/hub/src/preview/engineMock.ts   # mock implementation
```

## Interfaces / stubs (fill in)
```ts
import type { PreviewSpec, PreviewEngineKind } from "@aspex/schema";

export interface PreviewHandle {
  url: string;                                  // http://127.0.0.1:<port>
  stop(): Promise<void>;                         // idempotent teardown
  onExit(cb: (info: ExitInfo) => void): void;    // fires once on container exit/crash
}
export interface ExitInfo { code: number | null; message: string }

export interface PreviewEngine {
  kind: PreviewEngineKind;
  available(): Promise<boolean>;                 // capability probe (Docker present?)
  boot(spec: PreviewSpec): Promise<PreviewHandle>;
  sweep?(): Promise<void>;                        // optional: remove leftover containers (docker)
}

// Mock: always available; boot resolves a ready handle; test hooks can simulate a crash.
export function createMockEngine(opts?: {
  port?: number;                  // default 41999
  failBoot?: boolean;             // boot() rejects (engine-failure path)
}): PreviewEngine & { simulateExit(message: string): void };
```

## Behaviour
- **Interface (`engine.ts`):** export the types above. Document that `boot` must bind only `127.0.0.1`, must **pull-not-build**, and that `onExit` fires exactly once.
- **Mock (`engineMock.ts`):**
  - `available()` → `true`.
  - `boot(spec)` → if `opts.failBoot`, reject with a clear error. Else resolve a `PreviewHandle` with `url = http://127.0.0.1:<port>`, a no-op idempotent `stop()`, and an `onExit` registration.
  - `simulateExit(message)` → invokes the registered `onExit` once (lets the broker's crash test fire deterministically).
  - No timers, no real sockets, no Docker.

## Steps
1. `engine.ts` with `PreviewEngine` / `PreviewHandle` / `ExitInfo`.
2. `engineMock.ts` implementing the interface + `simulateExit`.
3. Tests `apps/hub/test/preview/engineMock.test.ts`: `available()` true; `boot` returns a handle with a `127.0.0.1` url; `failBoot` rejects; `simulateExit` triggers the `onExit` callback once; `stop` is idempotent.

## Acceptance check
```
cd apps/hub && bun test test/preview/engineMock.test.ts
```
Expected: all mock-engine cases pass with **no Docker**. `bun run typecheck` + `bun run lint` clean.

## Out of scope / do NOT do
- No Docker / no shelling out — that is card 38.
- No broker logic, no HTTP, no web.
- Do not add booting policy (trust gate, caps) here — the engine is dumb; policy lives in the broker (card 40).
- `boot` must never build an image or bind a non-loopback interface.
