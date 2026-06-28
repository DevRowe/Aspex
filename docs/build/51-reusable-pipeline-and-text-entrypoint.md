# Card 51 — Reusable pipeline + typed text entrypoint (`POST /intent`)

## Goal
Extract the **closed-grammar → free-form-fallback → reduce → effect** pipeline so it serves both the voice path (`audio → STT → pipeline`) and a new **typed** path (`text → pipeline`), then expose it over HTTP as `POST /intent`. This makes free-form intent usable **with voice disabled** (ADR-0018) — the [[Intent bar]]'s backend.

## Depends on
- Card 50 (the gateway with the free-form fallback), Card 28 (`registerVoiceRoutes`, the voice HTTP + `ServerDeps.voiceGateway`), Card 27 (`VoiceGateway`).

## Files to edit
```
apps/hub/src/voice/gateway.ts        # extract runPipeline(); add public handleText()
apps/hub/src/http/voice.ts           # add POST /intent (text + context)
apps/hub/test/intent-http.test.ts    # new
```

## Refactor (`gateway.ts`)
`handle(audio, mime, context)` today does STT then the pipeline. Extract the part after transcription:
```ts
// pure-ish: transcript + context -> VoiceResult (closed grammar -> fallback -> reduce -> effect)
private async runPipeline(transcript: Transcript, context: VoiceContext): Promise<VoiceGatewayResult> { /* the body that follows STT today */ }

async handle(audio, mime, context) {
  let transcript;
  try { transcript = await this.deps.stt.transcribe(audio, mime); }
  catch { return this.withAudio({ ok:false, readback:"I couldn't hear that.", session:this.session }); }
  return this.runPipeline(transcript, context);
}

// NEW — typed entry: no STT, exact text, confidence 1 (bypasses the confidence gate; still runs the closed grammar first).
async handleText(text: string, context: VoiceContext): Promise<VoiceGatewayResult> {
  return this.runPipeline({ text, confidence: 1 }, context);
}
```

## HTTP (`http/voice.ts`, extends card 28)
| Method | Path | Purpose |
|---|---|---|
| POST | `/intent` | JSON `{ text: string, context: VoiceContext }` → `VoiceResult`. `assertVoiceContext`. If no gateway → `503 {error:"intent not configured"}`. Read-back audio handled exactly like `/voice/utterance` (cache → `audioUrl`). |

```ts
app.post("/intent", async (c) => {
  if (!deps.voiceGateway) return c.json({ error: "intent not configured" }, 503);
  const { text, context } = await c.req.json();
  assertVoiceContext(context);
  if (typeof text !== "string" || text.trim() === "") return c.json({ error: "text required" }, 400);
  const result = await deps.voiceGateway.handleText(text, context);
  // stash audio (if any) -> audioUrl, same as card 28
  return c.json(result);
});
```

## Steps
1. Extract `runPipeline`; keep `handle` behaviourally identical (a refactor — existing card-27/28 tests must still pass).
2. Add `handleText`.
3. Register `POST /intent` alongside the voice routes; reuse the card-28 audio cache + card-07 CORS.
4. Tests via `app.fetch(new Request(...))` with a fake gateway.

## Acceptance check
```bash
bun test apps/hub/test/intent-http.test.ts apps/hub/test/voice-http.test.ts     # green (no regression)
```
Tests must prove:
- `POST /intent {text:"what needs me", context}` → 200 with the needs-me read-back (closed grammar, **no LLM**).
- `POST /intent {text:"approve the atlas review", context}` with a fake gateway whose intent service arms → 200 armed; a follow-up `POST /intent {text:"confirm approve"}` → dispatched once.
- `handleText` produces the **same `VoiceResult` shape** as `handle`.
- Missing/blank `text` → 400; bad `context` → 400; no gateway → 503.
- Existing `/voice/utterance` tests still pass (the refactor didn't change voice behaviour).

## Out of scope / do NOT do
- No web UI (card 52) — backend only.
- No streaming; one POST per line (single-shot).
- Keep `/voice/utterance` unchanged; the text path must **not** require STT (a gateway built for intent-only has no real STT — `handleText` never calls it).
- Do not duplicate safe-grammar logic — `runPipeline` is the single source (server-side, guardrail 11/21).
