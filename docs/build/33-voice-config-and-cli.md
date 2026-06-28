# Card 33 — Voice config + CLI

## Goal
Wire voice into config and the `aspex` CLI: a `voice` config section (endpoints, thresholds, timeouts, PTT key), construct the STT/TTS clients + `VoiceGateway` in `boot.ts`, pass it to the HTTP server, and add `aspex voice check` to ping the services. After this card, a configured Hub serves the voice endpoint end-to-end.

## Depends on
- Card 09 (`config.ts`, `boot.ts`, `cli.ts`), Card 24 (clients), Card 27 (gateway), Card 28 (server accepts `voiceGateway`).

## Files to edit
```
apps/hub/src/config.ts        # add VoiceConfig
apps/hub/src/boot.ts          # build clients + gateway when voice.enabled
apps/hub/src/cli.ts           # `aspex voice check`
apps/hub/test/config.test.ts  # extend
```

## Config (additive to card 09's `AspexConfig`)
```ts
export interface VoiceConfig {
  enabled: boolean;                 // default false (voice is opt-in)
  stt: { endpoints: string[]; timeoutMs: number };   // ordered (ADR-0013). e.g. ["http://gpubox:8901","http://localhost:8901"]
  tts: { endpoint?: string };       // omit => text-only read-back
  confidenceThreshold: number;      // default 0.6 (card 25 gate)
  confirmTtlMs: number;             // default 8000 (card 26 expiry)
  pttKey: string;                   // default "Space" (served to the web client, card 31)
  mock?: boolean;                   // use Mock STT/TTS (CI / no GPU)
}
// AspexConfig gains:  voice?: VoiceConfig;
```
- Env overrides: `ASPEX_VOICE_ENABLED`, `ASPEX_VOICE_STT` (comma-sep endpoints), `ASPEX_VOICE_TTS`, `ASPEX_VOICE_CONFIDENCE`.
- The `pttKey` (and `enabled`) are exposed to the web client via a small `GET /voice/config` (add to card 28's routes or here) so the client uses the configured key without rebuilds. Keep it tiny: `{ enabled, pttKey }`.

## Boot wiring (`boot.ts`)
```ts
let voiceGateway;
if (cfg.voice?.enabled) {
  const stt = cfg.voice.mock ? new MockSttClient() : new HttpSttClient(cfg.voice.stt);
  const tts = cfg.voice.mock ? new MockTtsClient()
            : cfg.voice.tts?.endpoint ? new HttpTtsClient({ endpoint: cfg.voice.tts.endpoint }) : null;
  voiceGateway = new VoiceGateway({
    stt, tts,
    dispatchAction: registry.dispatchAction.bind(registry),
    getSelectedActions: (id) => registry.actionsFor(id),   // from the world-model/registry
    resolveProject: (name) => resolveProjectId(world, name),
    snapshotNeedsMe: () => rank(world.getAll(), cfg.needsMeCap).needsMe.map(i => i.id),
    readItem: (id) => world.get(id)?.summary ?? "Nothing selected.",
    confidenceThreshold: cfg.voice.confidenceThreshold,
    confirmTtlMs: cfg.voice.confirmTtlMs,
  });
}
const app = buildApp({ /* …card 09 deps… */, voiceGateway });
```

## CLI
| Command | Action |
|---|---|
| `aspex voice check [--config p]` | build the STT/TTS clients from config; hit each STT endpoint's `/health` + a tiny `/transcribe` probe and the TTS `/speak`; print which endpoints are reachable (and which fallback would be used). Non-zero exit if none reachable. |

`aspex hub`/`aspex up` are unchanged except they now construct the gateway when `voice.enabled`.

## Steps
1. Add `VoiceConfig` + defaults + env overrides + `expandHome` (none needed) to `config.ts`.
2. Wire the gateway in `boot.ts` exactly as above (mock when `voice.mock`).
3. Add `GET /voice/config` (tiny) for the client.
4. Implement `aspex voice check`.
5. Extend `config.test.ts` (defaults; `enabled:false` => no gateway; env override of endpoints).

## Acceptance check
```bash
# mock voice, no GPU:
ASPEX_VOICE_ENABLED=1 bun run apps/hub/src/cli.ts hub --mock &   # or a config with voice.mock
curl -s 127.0.0.1:4317/voice/health      # {"ok":true,"stt":"mock",...}
curl -s 127.0.0.1:4317/voice/config      # {"enabled":true,"pttKey":"Space"}
bun run apps/hub/src/cli.ts voice check   # mock endpoints reachable -> exit 0
bun test apps/hub/test/config.test.ts     # green
```
- With `voice.enabled` false/absent → `POST /voice/utterance` returns 503 (card 28) and no gateway is built.

## Out of scope / do NOT do
- Do not enable voice by default (`enabled:false`) — it's opt-in and needs services configured.
- Do not bind to `0.0.0.0` or add auth (card 09 boundary holds). The GPU box is reached *outbound* over the tailnet; the Hub itself stays `127.0.0.1`.
- Do not put real model code in the Hub (ADR-0013) — `voice check` only does HTTP probes.
- Do not read the github token differently — unchanged from card 09.
