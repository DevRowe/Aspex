# Card 30 — Reference Parakeet STT + Piper TTS server

## Goal
A small **reference service** that implements the voice-service contract (ADR-0013, card 24) with real models: Parakeet for `/transcribe`, Piper for `/speak`. It runs on the GPU "Ollama box" (or localhost). This is a *separate* Python service — the Hub never imports it; it only speaks HTTP to it. Ship a no-model mock mode too, so the service itself is checkable without a GPU.

## Depends on
- Card 24 (defines the contract this must satisfy). Independent of the web cards.

## Files to create
```
services/voice-server/README.md           # how to install + run (GPU box + localhost)
services/voice-server/pyproject.toml       # or requirements.txt
services/voice-server/server.py            # FastAPI app: /transcribe, /speak, /health
services/voice-server/stt_parakeet.py      # Parakeet (NeMo) wrapper; lazy-load model
services/voice-server/tts_piper.py         # Piper wrapper (subprocess or python binding)
services/voice-server/test_contract.py     # contract test against MOCK backend (no GPU)
```

## Contract to implement (must match card 24 exactly)
```
POST /transcribe   body: raw audio bytes (content-type = audio/webm | audio/wav | …)
                   -> 200 { "text": string, "confidence": number }   # confidence 0..1
POST /speak        body: { "text": string }   -> 200 audio/wav  (or 204 if TTS disabled)
GET  /health       -> 200 { "ok": true, "stt": "parakeet"|"mock", "tts": "piper"|"mock"|"off" }
```
- Accept `webm/opus` input (the browser's `MediaRecorder` default) — decode to PCM (e.g. ffmpeg/`av`) before Parakeet. Document the ffmpeg dependency.
- `confidence`: use Parakeet's score if available; else a calibrated proxy (e.g. from logprobs). Document how it's derived — the Hub's confidence gate (card 25) depends on it being meaningful.
- `VOICE_BACKEND=mock` env → return a fixed transcript / silent WAV with **no** model load (lets `test_contract.py` and CI run without a GPU).

## Steps
1. FastAPI app with the three routes; `VOICE_BACKEND` switch (`real` | `mock`).
2. `stt_parakeet.py`: lazy-load the model once; decode incoming audio → transcribe → `{text, confidence}`.
3. `tts_piper.py`: text → WAV bytes via Piper.
4. `README.md`: install (CUDA/Parakeet/Piper/ffmpeg), run on the GPU box, the URL to put in Aspex config (`voice.stt.endpoints`, `voice.tts.endpoint`), and the localhost dev recipe.
5. `test_contract.py` (mock backend): assert the response shapes match the contract.

## Acceptance check
```bash
# no GPU needed:
cd services/voice-server
VOICE_BACKEND=mock python -m pytest        # contract tests green
VOICE_BACKEND=mock uvicorn server:app --port 8901 &
curl -s localhost:8901/health              # {"ok":true,"stt":"mock",...}
curl -s -X POST localhost:8901/transcribe --data-binary @sample.webm -H 'content-type: audio/webm'
# -> {"text": "...", "confidence": <0..1>}
```
- Shapes exactly match card 24's `SttClient`/`TtsClient` expectations (point `HttpSttClient` at it in a manual smoke).
- Real-model smoke (manual, on the GPU box) documented in the README, not required for CI.

## Out of scope / do NOT do
- This service is **not** imported by the Hub and **not** Bun — it's a standalone Python service reached over HTTP (ADR-0010/0013). Do not add it to the Bun workspace.
- Do not bake secrets in; no auth needed on a trusted tailnet, but bind to the LAN/tailnet interface deliberately and document it.
- Do not implement streaming — batch transcription of one utterance (the plan's Parakeet strength).
- Do not put the CPU-fallback model here as code — it's just another instance of this same server (or a whisper.cpp server) configured as a second endpoint (ADR-0013).
