# Card 28 — Hub HTTP voice endpoint

## Goal
Expose the voice gateway over HTTP: `POST /voice/utterance` accepts the audio + the `VoiceContext` and returns a `VoiceResult`, with the Piper read-back audio fetchable. Extends the card-07 Hono app; SSE/REST only (ADR-0005), `127.0.0.1` only.

## Depends on
- Card 27 (`VoiceGateway`), Card 07 (`buildApp` / `ServerDeps`), Card 23 (`assertVoiceContext`, `VoiceResult`).

## Files to create / edit
```
apps/hub/src/http/voice.ts          # registerVoiceRoutes(app, deps)
apps/hub/test/voice-http.test.ts
# edit apps/hub/src/http/server.ts  # call registerVoiceRoutes when a gateway is provided
```

## Wire-up
Add an optional gateway to `ServerDeps` (card 07) — keep it optional so a voice-less Hub still boots:
```ts
export interface ServerDeps {
  /* …existing… */
  voiceGateway?: import("../voice/gateway").VoiceGateway;   // present only when voice is configured
}
```

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/voice/utterance` | `multipart/form-data`: `audio` (file) + `context` (JSON string). `assertVoiceContext`. → `VoiceResult` (JSON). `audioUrl`, if any, points at `/voice/audio/:id`. If no `voiceGateway` → `503 {error:"voice not configured"}`. |
| GET | `/voice/audio/:id` | Returns the cached Piper WAV for that read-back (`audio/wav`); 404 if expired. |
| GET | `/voice/health` | `200 {ok, stt:"mock"|"http", tts:bool}` for `aspex voice check` (card 33). |

The gateway returns read-back **audio bytes**; this card caches them under a short-lived id (small in-memory LRU/TTL map) and sets `audioUrl` so the JSON stays small and the client fetches/plays it.

## Stub
```ts
export function registerVoiceRoutes(app: Hono, deps: ServerDeps) {
  app.post("/voice/utterance", async (c) => {
    if (!deps.voiceGateway) return c.json({ error: "voice not configured" }, 503);
    const form = await c.req.formData();
    const file = form.get("audio") as File;
    const context = JSON.parse(String(form.get("context")));
    assertVoiceContext(context);
    const result = await deps.voiceGateway.handle(new Uint8Array(await file.arrayBuffer()), file.type, context);
    // if result has audio bytes: stash -> id; result.audioUrl = `/voice/audio/${id}`
    return c.json(result);
  });
  // GET /voice/audio/:id ; GET /voice/health
}
```

## Steps
1. Add the optional `voiceGateway` to `ServerDeps`; call `registerVoiceRoutes` from `buildApp` when present.
2. Implement the three routes; reuse the card-07 CORS (already allows `localhost:*` + `tauri://localhost`).
3. Implement the short-TTL audio cache (id → bytes, evict after e.g. 60s).
4. Validation failures → `400`; missing gateway → `503`.
5. Tests via `app.fetch(new Request(...))` with a fake gateway (no real audio needed).

## Acceptance check
```bash
bun test apps/hub/test/voice-http.test.ts     # green
```
Tests must prove:
- `POST /voice/utterance` (multipart, valid context, fake gateway returning a `VoiceResult`) → 200 with that result; if the result carried audio, `audioUrl` is set and `GET /voice/audio/:id` returns the bytes.
- bad/missing `context` → 400.
- no `voiceGateway` configured → 503.
- `GET /voice/health` → 200 with the shape.

## Out of scope / do NOT do
- No WebSocket/streaming audio (ADR-0005) — one POST per utterance.
- No auth; bind stays `127.0.0.1` (card 09). Voice is local-only.
- Do not put gateway logic here — this is transport + the audio cache only.
- Do not persist audio to disk or the DB — short-lived in-memory only.
