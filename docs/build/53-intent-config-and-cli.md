# Card 53 — Free-form intent config + CLI

## Goal
Wire free-form intent into config and the `aspex` CLI: an `intent` config section, construct the `IntentService` + attach it to the gateway in `boot.ts` (**building a gateway when `intent.enabled` even if voice is off**), expose `intent.enabled` to the web client, and add `aspex intent check`. After this card a configured Hub serves `/intent` end-to-end.

## Depends on
- Card 09 (`config.ts`, `boot.ts`, `cli.ts`), Card 48 (`IntentService`), Cards 50/51 (the gateway uses `intentService` + `snapshotCandidates` and serves `/intent`), Card 33 (the voice-config pattern to mirror).

## Files to edit
```
apps/hub/src/config.ts        # add IntentConfig (mirror VoiceConfig: defaults, env, normalize/validate)
apps/hub/src/boot.ts          # build IntentService + gateway when intent.enabled || voice.enabled
apps/hub/src/cli.ts           # `aspex intent check`
apps/hub/test/config.test.ts  # extend
```

## Config (additive to `AspexConfig`, mirroring `VoiceConfig`)
```ts
export interface IntentConfig {
  enabled: boolean;          // default false (free-form is opt-in, ADR-0018)
  endpoints: string[];       // ordered Ollama base URLs, e.g. ["http://gpubox:11434","http://127.0.0.1:11434"]
  model: string;             // default "llama3.1"
  timeoutMs: number;         // default 8000
  elevateConfirm: boolean;   // default true (ADR-0020)
  mock?: boolean;            // MockIntentService (CI / no GPU)
}
// AspexConfig gains:  intent?: IntentConfig;
```
- Defaults: `DEFAULT_INTENT_CONFIG = { enabled:false, endpoints:["http://127.0.0.1:11434"], model:"llama3.1", timeoutMs:8000, elevateConfirm:true }`.
- Env overrides (mirror the voice ones): `ASPEX_INTENT_ENABLED`, `ASPEX_INTENT_ENDPOINTS` (csv), `ASPEX_INTENT_MODEL`, `ASPEX_INTENT_MOCK`.
- Validate: `endpoints` non-empty **when enabled and not mock**; `timeoutMs` positive integer; follow the `normalizeVoiceConfig` style/error shape exactly.

## Boot wiring (`boot.ts`)
```ts
const intentService =
  cfg.intent?.enabled
    ? (cfg.intent.mock || cfg.mock ? new MockIntentService()
        : new OllamaIntentService({ endpoints: cfg.intent.endpoints, model: cfg.intent.model, timeoutMs: cfg.intent.timeoutMs }))
    : undefined;

// Build a gateway when EITHER voice or intent is enabled (the text path needs no STT).
if (cfg.voice?.enabled || cfg.intent?.enabled) {
  voiceGateway = new VoiceGateway({
    stt: cfg.voice?.enabled ? realOrMockStt : new MockSttClient(),   // unused by handleText
    tts: /* as card 33, or null when voice off */,
    /* …existing dispatch/getSelectedActions/resolveProject/snapshotNeedsMe/readItem… */
    intentService,
    snapshotCandidates: () => rank(world.getAll(), cfg.needsMeCap).needsMe.map(i => ({
      itemId: i.id, summary: i.summary, actions: (i.actions ?? []).map(a => a.id),
    })),
    elevateFreeformConfirm: cfg.intent?.elevateConfirm ?? true,
    confidenceThreshold: cfg.voice?.confidenceThreshold ?? 0.6,
    confirmTtlMs: cfg.voice?.confirmTtlMs ?? 8000,
  });
}
```

## CLI
| Command | Action |
|---|---|
| `aspex intent check [--config p]` | build the `IntentService` from config; probe each Ollama endpoint (`GET /api/tags`, or a tiny constrained `/api/chat`); print reachable endpoints + which fallback would be used; non-zero exit if none reachable. Mock → exit 0. |

## Steps
1. Add `IntentConfig` + defaults + env + normalize/validate (mirror `normalizeVoiceConfig`).
2. Build `IntentService` + gateway in `boot.ts` per above; expose `intentEnabled` on the client config route (extend card 33's `GET /voice/config` or add `GET /intent/config`).
3. Implement `aspex intent check`.
4. Extend `config.test.ts`: defaults; `enabled:false` → no service/gateway-from-intent; env override of endpoints; `enabled:true` + empty endpoints + not mock → rejected.

## Acceptance check
```bash
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun run apps/hub/src/cli.ts hub --mock &
curl -s -X POST 127.0.0.1:4317/intent -H 'content-type: application/json' \
  -d '{"text":"what needs me","context":{"needsMeIds":[]}}'   # 200 VoiceResult
bun run apps/hub/src/cli.ts intent check   # mock -> exit 0
bun test apps/hub/test/config.test.ts      # green
```
- With `intent.enabled` false/absent and voice off → `POST /intent` → 503, no gateway built.
- With `intent.enabled` true and voice off → `/intent` works; `/voice/utterance` → 503 (no real STT).

## Out of scope / do NOT do
- Do not enable intent by default (`enabled:false`) — opt-in, needs Ollama (or `intent.mock`).
- Do not bind to `0.0.0.0` or add auth (card 09 boundary holds). Ollama is reached **outbound**; the Hub stays `127.0.0.1`.
- Do not put model code in the Hub (ADR-0019) — `intent check` does HTTP probes only.
- Adapter config (codex/opencode/cursor) is **card 57**, not here.
