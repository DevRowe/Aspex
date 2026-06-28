# Card 31 — Web: audio capture + push-to-talk control

## Goal
Capture one Utterance per push-to-talk press in the browser (`getUserMedia` + `MediaRecorder`), assemble the `VoiceContext` from the store, POST it to `/voice/utterance`, and play the returned Piper read-back. Provide the two triggers: an on-screen hold-button and the hold-`Space` key (suppressed while typing).

## Depends on
- Card 28 (`POST /voice/utterance`), Card 23 (`VoiceContext`, `VoiceResult`), Card 11 (store, hubClient), Card 12 (`selectedId` in the store).

## Files to create
```
apps/web/src/voice/useCapture.ts       # MediaRecorder lifecycle hook
apps/web/src/voice/usePushToTalk.ts    # button + Space binding -> start/stop capture
apps/web/src/voice/voiceClient.ts      # postUtterance(audioBlob, context) -> VoiceResult; play audioUrl
apps/web/src/components/PttButton.tsx
```

## Behaviour
- **Capture (`useCapture`):** on `start()` → `getUserMedia({audio:true})` (cache the stream), `new MediaRecorder(stream)`, collect chunks; on `stop()` → resolve a single `Blob` (`audio/webm`). Surface a `phase`: `idle | listening | error`. Handle the **mic-permission** prompt; on deny → `error` with a clear message (card 32 renders it). In the **Tauri webview**, mic permission must be granted to the app — document in card 33 / README.
- **Push-to-talk (`usePushToTalk`):**
  - On-screen button: `pointerdown` → `start()`, `pointerup`/`pointerleave` → `stop()` then send. (Works for mouse + DeX touch.)
  - Key: `keydown` of the configured key (default `Space`) → `start()` (ignore auto-repeat); `keyup` → `stop()` + send. **Suppress when the focused element is an input/textarea/contenteditable** (so typing a confirm or a search isn't hijacked).
  - Ignore a new press while one is in flight (or cancel+restart — pick one; document it). New press **cancels any playing read-back** audio.
- **Send (`voiceClient`):** build `context = { selectedId, needsMeIds }` from the store; `POST` multipart (`audio` + `context` JSON) to the Hub; on `VoiceResult` → (a) hand it to the store/UX (card 32), (b) if `audioUrl`, fetch + play via an `HTMLAudioElement`.

## Stub
```ts
export function useCapture() {
  // returns { phase, start, stop }: start() begins recording, stop() resolves Blob
}
export async function postUtterance(audio: Blob, ctx: VoiceContext): Promise<VoiceResult> {
  const fd = new FormData();
  fd.append("audio", audio, "utterance.webm");
  fd.append("context", JSON.stringify(ctx));
  const r = await fetch(`${HUB}/voice/utterance`, { method: "POST", body: fd });
  return r.json();
}
```

## Steps
1. `useCapture` with `MediaRecorder` (cache the stream across presses; don't re-prompt each time).
2. `usePushToTalk`: pointer + key handlers, input-focus suppression, in-flight guard, stop-playback-on-new-press.
3. `voiceClient.postUtterance` + read-back playback.
4. `PttButton` (press-and-hold, shows the capture `phase`); wire into `App`.
5. The `VoiceResult` is forwarded to the card-32 layer (store action) — here just prove the round-trip.

## Acceptance check
With `hub --mock` (mock STT scripted to "what needs me") + `bun run dev`:
- Press-and-hold the button (or hold `Space`) → mic permission once → release → a `POST /voice/utterance` fires with a non-empty `audio` part and a `context` containing the current `selectedId` + `needsMeIds`.
- The returned `VoiceResult.readback` is received; if `audioUrl` present, audio plays.
- Holding `Space` **inside** a focused text input does **not** start capture.
- A second press while a read-back is playing stops the playback.
- (Unit-test `postUtterance` builds the multipart body correctly; DOM/Playwright test for the button if available.)

## Out of scope / do NOT do
- No staged-feedback UI, read-back rendering, or directive application (card 32) — this card proves capture + transport + playback.
- No native/Rust audio (ADR — browser APIs only).
- Do not parse or interpret the transcript on the client (ADR-0011 — the Hub decides). The client sends audio + context and renders the result.
- Do not hold the mic stream open continuously beyond what's needed (stop tracks when idle if simplest), and never auto-start without a press (no open mic).
