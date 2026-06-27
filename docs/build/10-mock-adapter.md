# Card 10 — Mock adapter + `examples/mock-events` (demo mode)

## Goal
A `mock` adapter that replays a scripted set of Signals — including every state/liveness/reason combination and the grilled edge cases — so the whole system can be built and demoed with **no real agents**. Enabled by `--mock`.

## Depends on
- Card 02 (Adapter), Card 08 (registry), Card 09 (CLI registers it under `--mock`).

## Files to create
```
examples/mock-events/script.json     # array of timed Signals
packages/adapter-mock/package.json
packages/adapter-mock/src/index.ts    # MockAdapter implements Adapter
packages/adapter-mock/test/mock.test.ts
```

## The script (must include these cases)
`script.json` is an array of `{ atMs: number, signal: Signal }`. Include at least:
1. A github PR **review-requested** (`review_requested`, needs_review, attentionRequired, actions: approve/comment).
2. A github PR that is **author + failing CI** (`failing_ci`) — and ALSO carries a "review_requested" hint, to prove it renders as **one** card on the higher rung (card 05 scenario).
3. A github PR **awaiting merge** (`awaiting_merge`, action: merge — risk `dangerous`, requiresConfirmation).
4. A claude-code session **blocked** (`blocked_on_human`, deepLink, no actions).
5. A claude-code session that goes **working → done** over time (ends Ambient, not needs-me).
6. A claude-code **working** session that then **stops emitting heartbeats**, so liveness visibly decays `live → quiet → stale → lost`.
7. A generic **webhook** info item (Ambient).

## Stub
```ts
import type { Adapter, AdapterContext } from "@aspex/schema";
import script from "../../../examples/mock-events/script.json";

export class MockAdapter implements Adapter {
  id = "mock";
  private timers: Timer[] = [];
  async start(ctx: AdapterContext) {
    // schedule each entry at atMs; for "working" items also schedule periodic ctx.heartbeat(source)
    // EXCEPT case 6, where heartbeats stop to demo decay.
  }
  listActions() { return []; }       // actions are baked into the Signals
  async runAction() { return { ok: true, message: "mock action" }; }
  async stop() { this.timers.forEach(clearTimeout); }
}
```
> Note: the mock emits Signals tagged with their real `source` (`github`, `claude-code`, `webhook`) so the UI looks realistic, even though the adapter id is `mock`. The registry routes mock actions back to the mock adapter via a special-case (or the mock also answers for those sources in demo mode). Keep this clearly demo-only.

## Steps
1. Author `script.json` covering the 7 cases.
2. Implement `MockAdapter.start` scheduling emits + heartbeats.
3. In `cli.ts` (card 09), when `--mock`, `registry.register(new MockAdapter())` and skip real adapters.
4. Test that starting the adapter emits the expected Signals in order (use a fake context capturing emits, with a controllable clock).

## Acceptance check
```bash
bun run apps/hub/src/cli.ts hub --mock &
sleep 3
curl -s http://127.0.0.1:4317/state | jq '.needsMe[].reason'
# includes blocked_on_human, failing_ci, review_requested, awaiting_merge; NOT the done/working ambient ones
```
Plus `bun test packages/adapter-mock` green.

## Out of scope / do NOT do
- Do not hit any network. Fully offline.
- Do not ship the mock adapter in the production build path (it's dev/demo only) — but it may stay in the repo.
