# Card 18 — `adapter-ntfy` (off-device alerts, out-channel)

## Goal
Push a notification to your phone/watch when something **newly** needs you at high severity, so you can step away from the screen. This is an **out-channel** (it consumes world-model changes; it never ingests Items).

## Depends on
- Card 04 (bus `world:changed`), Card 09 (config `ntfy`).

## Files to create
```
packages/adapter-ntfy/package.json
packages/adapter-ntfy/src/index.ts     # NtfyNotifier (subscribes to the bus)
packages/adapter-ntfy/test/ntfy.test.ts
```

## Behaviour
- Subscribe to `bus.on("world:changed", ...)`.
- For each upserted Item, fire an ntfy publish **only on a transition INTO needs-me** at/above `minSeverity` (default `high`) — i.e. it was not attention-worthy before and now is. Track last-notified state per id to avoid re-alerting (de-dupe).
- Publish = `POST {ntfy.server||"https://ntfy.sh"}/{topic}` with a title (reason label) + body (`summary`) + a click-through to the deep-link/PR url. Priority maps from severity.
- Failures are logged and swallowed (never crash the Hub).
- It implements the `Adapter` interface minimally (`listActions: []`, `runAction: no-op`) OR is registered as a plain bus subscriber — either is fine; keep it isolated.

## Stub
```ts
export class NtfyNotifier {
  private lastAttention = new Map<string, boolean>();
  constructor(private cfg: { server?: string; topic: string; minSeverity?: "medium"|"high" }, bus: Bus) {
    bus.on("world:changed", ({ upserted }) => upserted.forEach((i) => this.maybeNotify(i)));
  }
  private maybeNotify(item: AttentionItem) { /* transition check + severity gate + POST */ }
}
```

## Acceptance check
```bash
bun test packages/adapter-ntfy   # green (fetch mocked)
```
Tests prove:
- An Item that **becomes** `attentionRequired` with `severity:"high"` → exactly **one** publish.
- The same Item updated again (still attention) → **no** second publish (de-dupe).
- A `medium` severity item with `minSeverity:"high"` → no publish.
- An ntfy HTTP failure does not throw out of `maybeNotify`.

## Out of scope / do NOT do
- Do not ingest or create Items — out-channel only.
- Do not notify for every change — only transitions into needs-me at/above the threshold (calm-by-default extends to your phone).
- No other notifiers (email/Slack) in Phase 0.
