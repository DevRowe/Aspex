from __future__ import annotations

import os
import struct
from functools import lru_cache
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

from stt_parakeet import ParakeetTranscriber
from tts_piper import PiperSpeaker

BackendName = Literal["real", "mock"]
SttHealth = Literal["parakeet", "mock"]
TtsHealth = Literal["piper", "mock", "off"]

app = FastAPI(title="Aspex Reference Voice Server")


class TranscriptResponse(BaseModel):
    text: str
    confidence: float


class SpeakRequest(BaseModel):
    text: str


def _backend() -> BackendName:
    value = os.environ.get("VOICE_BACKEND", "real").strip().lower()
    if value == "mock":
        return "mock"
    if value == "real":
        return "real"
    raise RuntimeError("VOICE_BACKEND must be 'real' or 'mock'")


def _tts_mode() -> str:
    return os.environ.get("VOICE_TTS", "").strip().lower()


@lru_cache(maxsize=1)
def _transcriber() -> ParakeetTranscriber:
    return ParakeetTranscriber()


@lru_cache(maxsize=1)
def _speaker() -> PiperSpeaker:
    return PiperSpeaker()


@app.get("/health")
def health() -> dict[str, bool | SttHealth | TtsHealth]:
    backend = _backend()
    tts_mode = _tts_mode()
    stt: SttHealth = "mock" if backend == "mock" else "parakeet"
    if tts_mode == "off":
        tts: TtsHealth = "off"
    elif backend == "mock" or tts_mode == "mock":
        tts = "mock"
    else:
        tts = "piper"
    return {"ok": True, "stt": stt, "tts": tts}


@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(request: Request) -> TranscriptResponse:
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="audio body is required")

    if _backend() == "mock":
        return TranscriptResponse(
            text=os.environ.get("ASPEX_MOCK_TRANSCRIPT", "approve"),
            confidence=_clamp_float(os.environ.get("ASPEX_MOCK_CONFIDENCE", "1.0"), 1.0),
        )

    content_type = request.headers.get("content-type", "application/octet-stream")
    try:
        result = _transcriber().transcribe(audio, content_type)
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return TranscriptResponse(text=result.text, confidence=result.confidence)


@app.post("/speak")
async def speak(payload: SpeakRequest) -> Response:
    if _tts_mode() == "off":
        return Response(status_code=204)

    if _backend() == "mock" or _tts_mode() == "mock":
        return Response(content=_silent_wav(), media_type="audio/wav")

    try:
        wav = _speaker().speak(payload.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return Response(content=wav, media_type="audio/wav")


def _clamp_float(value: str, default: float) -> float:
    try:
        parsed = float(value)
    except ValueError:
        parsed = default
    return max(0.0, min(1.0, parsed))


def _silent_wav(sample_rate: int = 16000, samples: int = 1600) -> bytes:
    data = b"\x00\x00" * samples
    byte_rate = sample_rate * 2
    block_align = 2
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(data))
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, block_align, 16)
        + b"data"
        + struct.pack("<I", len(data))
        + data
    )
