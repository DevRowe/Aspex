# Card 24 — STT/TTS clients + mock (the voice-service contract)

## Goal
The Hub-side clients that speak the generic voice-service HTTP contract (ADR-0013): `transcribe(audio)` over an **ordered list of endpoints** with fallback + timeout, and `speak(text)` against the TTS endpoint. Plus a **mock** implementation (canned transcript / silent WAV) so the whole voice loop is testable with no GPU.

## Depends on
- Card 23 (`Transcript` type). Config is injected here; real wiring is card 33.

## Files to create
```
apps/hub/src/voice/sttClient.ts      # SttClient interface + HttpSttClient + MockSttClient
apps/hub/src/voice/ttsClient.ts      # TtsClient interface + HttpTtsClient + MockTtsClient
apps/hub/test/sttClient.test.ts
```

## The contract (what the services implement — see card 30)
```
POST /transcribe   body: audio bytes (content-type = the blob's mime, e.g. audio/webm)
                   200 -> { "text": string, "confidence": number }   // confidence 0..1
POST /speak        body: { "text": string }
                   200 -> audio bytes (audio/wav), or 204 if TTS disabled
```

## Interfaces / stubs
```ts
import type { Transcript } from "@aspex/schema";

export interface SttClient {
  transcribe(audio: Uint8Array, mime: string): Promise<Transcript>;   // throws on total failure
}
export interface TtsClient {
  speak(text: string): Promise<Uint8Array | null>;                    // null if disabled; never throws
}

export interface HttpSttConfig { endpoints: string[]; timeoutMs: number; }  // endpoints tried IN ORDER
export class HttpSttClient implements SttClient {
  constructor(private cfg: HttpSttConfig) {}
  async transcribe(audio, mime) {
    // for each endpoint: POST with AbortController(timeoutMs); on 2xx -> parse {text,confidence};
    // on network error / non-2xx / timeout -> log + try next. If ALL fail -> throw VoiceServiceError.
  }
}
export class HttpTtsClient implements TtsClient { /* single endpoint; on any failure return null (read-back stays text-only) */ }

export class MockSttClient implements SttClient {
  constructor(private script: Transcript[] = []) {}   // shift() per call; default { text:"", confidence:1 }
}
export class MockTtsClient implements TtsClient { /* returns a tiny fixed silent WAV (or null) */ }
```

## Steps
1. Define the interfaces + `VoiceServiceError`.
2. `HttpSttClient`: ordered try-loop with `AbortController` timeout; validate the JSON shape; **only throw when every endpoint fails** (honours ADR-0013 fallback).
3. `HttpTtsClient`: single POST; swallow failures → `null` (read-back degrades to text-only, never breaks the loop — guardrail 13).
4. Mocks: `MockSttClient` shifts a scripted queue; `MockTtsClient` returns a constant silent WAV.
5. Tests with a stubbed `fetch`.

## Acceptance check
```bash
bun test apps/hub/test/sttClient.test.ts     # green
```
Tests must prove:
- First endpoint 500s, second returns `{text,confidence}` → `transcribe` resolves from the **second** (fallback works, in order).
- All endpoints fail/time out → `transcribe` **throws** `VoiceServiceError`.
- A timeout aborts and moves on (use a never-resolving stub + small `timeoutMs`).
- `HttpTtsClient` on a failing endpoint → resolves `null`, does **not** throw.
- `MockSttClient(["approve"])` returns that transcript then the default.

## Out of scope / do NOT do
- No grammar, no dispatch, no session — pure transport. The gateway (27) composes these.
- No real Parakeet/Piper here — that's the reference server (card 30). These are HTTP clients only.
- Do not read config files here — config is injected (card 33 wires it).
- Do not let a TTS failure throw; STT failure throws and the gateway turns it into a friendly read-back.
