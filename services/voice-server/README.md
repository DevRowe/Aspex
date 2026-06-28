# Aspex Reference Voice Server

Standalone FastAPI service for the Aspex voice-service HTTP contract:

- `POST /transcribe` accepts raw audio bytes and returns `{ "text": string, "confidence": number }`.
- `POST /speak` accepts `{ "text": string }` and returns `audio/wav`, or `204` when TTS is disabled.
- `GET /health` returns `{ "ok": true, "stt": "parakeet"|"mock", "tts": "piper"|"mock"|"off" }`.

The Hub never imports this code. Configure Aspex to call it over HTTP:

```toml
[voice.stt]
endpoints = ["http://127.0.0.1:8901/transcribe"]

[voice.tts]
endpoint = "http://127.0.0.1:8901/speak"
```

## Local mock mode

Mock mode loads no models and is the CI/development contract check.

POSIX shell:

```bash
cd services/voice-server
VOICE_BACKEND=mock uv run --no-project --with fastapi --with uvicorn --with pytest --with httpx python -m pytest
VOICE_BACKEND=mock uv run --no-project --with fastapi --with uvicorn uvicorn server:app --host 127.0.0.1 --port 8901
```

PowerShell:

```powershell
cd services/voice-server
$env:VOICE_BACKEND = "mock"
uv run --no-project --with fastapi --with uvicorn --with pytest --with httpx python -m pytest
uv run --no-project --with fastapi --with uvicorn uvicorn server:app --host 127.0.0.1 --port 8901
```

PowerShell virtualenv flow:

```powershell
cd services/voice-server
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[test]"
$env:VOICE_BACKEND = "mock"
.venv\Scripts\python -m pytest
.venv\Scripts\uvicorn server:app --host 127.0.0.1 --port 8901
```

POSIX virtualenv flow:

```bash
cd services/voice-server
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[test]"
VOICE_BACKEND=mock python -m pytest
VOICE_BACKEND=mock uvicorn server:app --host 127.0.0.1 --port 8901
```

Mock responses:

- `/transcribe` returns `ASPEX_MOCK_TRANSCRIPT` or `approve`, with confidence `ASPEX_MOCK_CONFIDENCE` or `1.0`.
- `/speak` returns a tiny silent WAV unless `VOICE_TTS=off`, in which case it returns `204`.

## GPU box real mode

Real mode is intended for the trusted localhost/tailnet GPU host:

PowerShell:

```powershell
cd services/voice-server
python -m venv .venv
.venv\Scripts\python -m pip install -e .
# Install NVIDIA CUDA/PyTorch/NeMo separately for the host.
$env:VOICE_BACKEND = "real"
$env:PARAKEET_MODEL = "nvidia/parakeet-tdt-0.6b-v2"
$env:PIPER_BIN = "C:\tools\piper\piper.exe"
$env:PIPER_MODEL = "C:\models\piper\en_US-lessac-medium.onnx"
.venv\Scripts\uvicorn server:app --host 0.0.0.0 --port 8901
```

POSIX shell:

```bash
cd services/voice-server
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
# Install NVIDIA CUDA/PyTorch/NeMo separately for the host.
VOICE_BACKEND=real \
PARAKEET_MODEL=nvidia/parakeet-tdt-0.6b-v2 \
PIPER_BIN=/opt/piper/piper \
PIPER_MODEL=/opt/piper/voices/en_US-lessac-medium.onnx \
uvicorn server:app --host 0.0.0.0 --port 8901
```

Bind deliberately. Use `127.0.0.1` for same-machine development, or the GPU box tailnet/LAN address when Hub runs elsewhere. This service has no authentication and is meant for a trusted local network only.

### Parakeet STT notes

`/transcribe` receives browser `MediaRecorder` audio such as `audio/webm;codecs=opus` or `audio/wav`. The wrapper shells out to `ffmpeg` first and normalizes input to mono 16 kHz PCM WAV before passing the file to Parakeet. Install `ffmpeg` and ensure it is on `PATH`, or set `FFMPEG_BIN`.

Install the actual NeMo/Parakeet stack following NVIDIA's current host-specific instructions. The wrapper imports `nemo.collections.asr.models.ASRModel` lazily on the first real transcription and calls `ASRModel.from_pretrained(PARAKEET_MODEL)`.

Confidence is derived from model metadata when a score-like field is exposed. If the Parakeet return shape has no usable score, the wrapper returns `PARAKEET_FALLBACK_CONFIDENCE` (default `0.75`). Treat this as a calibration point and adjust after collecting local utterance samples against Aspex's `voice.confidenceThreshold`.

### Piper TTS notes

`/speak` invokes the Piper command-line binary by subprocess. Set:

- `PIPER_BIN`: path to `piper` or `piper.exe`.
- `PIPER_MODEL`: path to the `.onnx` voice model.
- `PIPER_CONFIG`: optional path to the model JSON config.

The wrapper writes text to Piper stdin, asks Piper to write a temporary WAV file, then returns those WAV bytes. Set `VOICE_TTS=off` to keep STT real while disabling TTS; `/speak` will return `204`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_BACKEND` | `real` | `mock` avoids all model loads; `real` lazy-loads wrappers. |
| `VOICE_TTS` | backend default | `off` disables `/speak`; `mock` forces mock TTS in real backend. |
| `ASPEX_MOCK_TRANSCRIPT` | `approve` | Mock transcript text. |
| `ASPEX_MOCK_CONFIDENCE` | `1.0` | Mock transcript confidence, clamped to `0..1`. |
| `PARAKEET_MODEL` | `nvidia/parakeet-tdt-0.6b-v2` | NeMo pretrained model name/path. |
| `PARAKEET_FALLBACK_CONFIDENCE` | `0.75` | Confidence used when model output has no score. |
| `FFMPEG_BIN` | `ffmpeg` | Audio decoder path. |
| `PIPER_BIN` | `piper` | Piper executable path. |
| `PIPER_MODEL` | unset | Required for real Piper TTS. |
| `PIPER_CONFIG` | unset | Optional Piper model config path. |

## Manual contract smoke

```bash
curl -s http://127.0.0.1:8901/health
curl -s -X POST http://127.0.0.1:8901/transcribe --data-binary @sample.webm -H "content-type: audio/webm"
curl -i -X POST http://127.0.0.1:8901/speak -H "content-type: application/json" --data "{\"text\":\"Ready\"}" --output readback.wav
```
