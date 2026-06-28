from __future__ import annotations

import math
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Transcript:
    text: str
    confidence: float


class ParakeetTranscriber:
    """Lazy Parakeet boundary.

    Incoming browser audio can be webm/opus, wav, or another ffmpeg-readable
    format. The wrapper decodes it to mono 16 kHz PCM WAV before calling NeMo.
    Confidence uses a model-provided score/logprob when present; otherwise it
    falls back to PARAKEET_FALLBACK_CONFIDENCE because Parakeet return shapes
    vary by release.
    """

    def __init__(self) -> None:
        self.model_name = os.environ.get("PARAKEET_MODEL", "nvidia/parakeet-tdt-0.6b-v2")
        self.ffmpeg_bin = os.environ.get("FFMPEG_BIN", "ffmpeg")
        self.fallback_confidence = _clamp(
            _float_env("PARAKEET_FALLBACK_CONFIDENCE", 0.75)
        )
        self._model: Any | None = None

    def transcribe(self, audio: bytes, content_type: str) -> Transcript:
        wav_path = self._decode_to_wav(audio, content_type)
        try:
            model = self._load_model()
            raw = model.transcribe([str(wav_path)])
            item = _first_result(raw)
            text = _extract_text(item)
            confidence = _extract_confidence(item, self.fallback_confidence)
            return Transcript(text=text, confidence=confidence)
        finally:
            try:
                wav_path.unlink()
            except FileNotFoundError:
                pass

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model

        try:
            from nemo.collections.asr.models import ASRModel
        except ImportError as exc:
            raise ImportError(
                "Real STT requires NVIDIA NeMo with Parakeet support. "
                "Install the CUDA/PyTorch/NeMo stack on the GPU host, or set "
                "VOICE_BACKEND=mock for contract tests."
            ) from exc

        self._model = ASRModel.from_pretrained(self.model_name)
        return self._model

    def _decode_to_wav(self, audio: bytes, content_type: str) -> Path:
        suffix = _suffix_for_content_type(content_type)
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as source:
            source.write(audio)
            source_path = Path(source.name)

        target = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        target_path = Path(target.name)
        target.close()

        command = [
            self.ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            str(target_path),
        ]
        try:
            subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except FileNotFoundError as exc:
            raise RuntimeError(
                "ffmpeg is required to decode browser audio for Parakeet. "
                "Install ffmpeg or set FFMPEG_BIN."
            ) from exc
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"ffmpeg failed to decode {content_type}: {detail}") from exc
        finally:
            try:
                source_path.unlink()
            except FileNotFoundError:
                pass

        return target_path


def _first_result(raw: Any) -> Any:
    if isinstance(raw, (list, tuple)):
        if not raw:
            return ""
        return raw[0]
    return raw


def _extract_text(item: Any) -> str:
    if isinstance(item, str):
        return item
    for attr in ("text", "transcript"):
        value = getattr(item, attr, None)
        if isinstance(value, str):
            return value
    if isinstance(item, dict):
        for key in ("text", "transcript"):
            value = item.get(key)
            if isinstance(value, str):
                return value
    return str(item)


def _extract_confidence(item: Any, fallback: float) -> float:
    candidates = []
    if isinstance(item, dict):
        candidates.extend(item.get(key) for key in ("confidence", "score", "logprob", "log_probability"))
    else:
        candidates.extend(
            getattr(item, attr, None)
            for attr in ("confidence", "score", "logprob", "log_probability")
        )

    for value in candidates:
        if isinstance(value, (int, float)) and math.isfinite(value):
            if 0.0 <= value <= 1.0:
                return float(value)
            if value <= 0.0:
                return _clamp(math.exp(float(value)))
    return fallback


def _suffix_for_content_type(content_type: str) -> str:
    lowered = content_type.lower()
    if "webm" in lowered:
        return ".webm"
    if "wav" in lowered or "wave" in lowered:
        return ".wav"
    if "ogg" in lowered:
        return ".ogg"
    if "mpeg" in lowered or "mp3" in lowered:
        return ".mp3"
    return ".audio"


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))
