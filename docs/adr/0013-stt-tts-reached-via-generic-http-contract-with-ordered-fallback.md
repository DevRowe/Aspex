# STT/TTS are reached via a generic HTTP contract with ordered-endpoint fallback; models are pluggable and local-first

The voice gateway (ADR-0010) needs Parakeet (STT) and Piper (TTS), which run as services on the GPU "Ollama box". Parakeet is Python/CUDA and the Hub is Bun and must stay Bun-compile-safe (ADR-0008), so the models **cannot** run in-process. Rather than couple the Hub to Parakeet's and Piper's native interfaces, we define a **tiny generic HTTP contract** the Hub speaks: `POST /transcribe` (audio → `{ text, confidence }`) and `POST /speak` (text → audio). Services are located by **config URLs** (`voice.stt.endpoints`, `voice.tts.endpoint`), defaulting to the GPU box and `localhost` in dev.

`voice.stt.endpoints` is an **ordered list**: the gateway tries each in turn, so the whisper.cpp / faster-whisper CPU fallback is just a second URL behind the same contract — no bespoke per-model code. The repo ships a **reference Python STT server** (a thin FastAPI wrapper around Parakeet), a Piper wrapper for `/speak`, and a **mock STT/TTS** (canned transcript / silent WAV) so the whole loop is testable in CI with no GPU.

Read-back TTS goes through `/speak` (Piper) and the browser plays the returned audio; the **browser Web Speech API is dev-only and off by default** — the plan flags it as cloud-in-Chrome, which would break local-first.

We chose the abstraction over hard-wiring because it keeps the Hub model-agnostic (Parakeet today, whisper/faster-whisper/other tomorrow), makes the CPU fallback free, and makes mock-first CI possible — at the cost of one thin wrapper service per model. Consequence: model swaps and the fallback are config changes, not code changes; STT/TTS are **not** Adapters (ADR-0010).
