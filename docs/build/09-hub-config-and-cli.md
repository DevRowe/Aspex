# Card 09 — Hub: config + `aspex` CLI (wiring it all together)

## Goal
Load configuration, wire every Hub piece together (store → world-model → liveness → registry → HTTP), and expose the `aspex` CLI. After this card, `aspex hub` boots a working (but adapter-less) Hub you can curl.

## Depends on
- Cards 03–08.

## Files to create
```
apps/hub/src/config.ts
apps/hub/src/boot.ts        # buildHub(config) -> { app, registry, start, stop }
apps/hub/src/cli.ts         # arg parsing + commands
apps/hub/package.json       # add "bin": { "aspex": "src/cli.ts" }
apps/hub/test/config.test.ts
```

## Config

```ts
export interface AspexConfig {
  hubPort: number;            // default 4317, bind 127.0.0.1 ONLY
  dbPath: string;            // default "~/.aspex/aspex.sqlite"
  needsMeCap: number;        // default 7
  pollIntervalMs: number;    // default 60_000 (github search rate limit: 30/min)
  github?: { token: string; allowlist?: string[] };   // allowlist = extra "owner/repo" or "author:name"
  ntfy?: { server?: string; topic: string; minSeverity?: "medium" | "high" };
  liveness?: Partial<import("./engine/liveness").LivenessConfig>;
  mock?: boolean;            // demo mode (card 10)
}
```
- Load order: built-in defaults → config file (`--config <path>`, else `~/.aspex/config.json` if present) → env overrides (`ASPEX_HUB_PORT`, `ASPEX_GITHUB_TOKEN`, …).
- Missing optional sections are fine; the Hub runs adapter-less.

## CLI commands (this card)
| Command | Action |
|---|---|
| `aspex hub [--config p] [--mock]` | boot Hub (store+engine+http), listen, log the URL |
| `aspex up [--config p] [--mock]` | (Phase 0) same as `hub` for now; later also serves/launches the desktop app |
| `aspex --version` / `aspex --help` | print and exit |
| `aspex hooks ...` / `aspex hook-relay ...` | **declared here but implemented in card 16** — print "not yet installed" until then |

Use `util.parseArgs` (Bun-compatible) — no CLI framework dependency.

## `boot.ts`
```ts
export function buildHub(cfg: AspexConfig) {
  const db = openDb(cfg.dbPath);
  const store = new ItemStore(db);
  const bus = new Bus();
  const liveness = new LivenessTicker(() => store.getAll(), (i) => world.applySignal(i), livenessCfg);
  const world = new WorldModel(store, bus, {
    deriveAttention: enforceOwnership,              // card 05
    deriveLiveness: (i) => ({ ...i, staleAfter: nextStaleAfter(i.source, i.state, i.observedAt, livenessCfg), liveness: livenessAt(i, Date.now(), livenessCfg) }), // card 06
  });
  const registry = new AdapterRegistry(world, liveness);
  // adapters registered by the caller (cli) depending on --mock / config
  const app = buildApp({ worldModel: world, bus, cap: cfg.needsMeCap, version, dispatchAction: registry.dispatchAction.bind(registry), actionMeta: registry.actionMeta.bind(registry) });
  return { app, registry, world, start, stop };
}
```

## Steps
1. Implement config load + `expandHome` for `~`.
2. Implement `buildHub` exactly wiring cards 05 & 06 into the world-model derivers.
3. `cli.ts`: parse args, dispatch commands. For `hub`/`up`: `buildHub`, register adapters (none yet, or mock if `--mock` once card 10 exists), `Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch })`, start the liveness ticker, print `Aspex Hub on http://127.0.0.1:<port>`.
4. Handle SIGINT → `stop()` (stopAll adapters, close db).

## Acceptance check
```bash
bun run apps/hub/src/cli.ts hub &     # starts
curl -s http://127.0.0.1:4317/health  # -> {"ok":true,...}
curl -s -X POST http://127.0.0.1:4317/signals/webhook \
  -H 'content-type: application/json' \
  -d '{"id":"webhook:test","source":"webhook","state":"needs_review","summary":"hi","attentionRequired":true}'
curl -s http://127.0.0.1:4317/state   # includes webhook:test in needsMe
```
Plus `bun test apps/hub/test/config.test.ts` green (defaults + env override + file merge).

## Out of scope / do NOT do
- Do not implement real adapters or `hooks`/`hook-relay` logic (cards 10, 15–18).
- Do not bind to `0.0.0.0` or add auth — local-only, `127.0.0.1` (security boundary).
- Do not read secrets from the repo; the github token comes from config/env only.
