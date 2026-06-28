from __future__ import annotations

import importlib

from fastapi.testclient import TestClient


def _client(monkeypatch):
    monkeypatch.setenv("VOICE_BACKEND", "mock")
    monkeypatch.delenv("VOICE_TTS", raising=False)
    import server

    importlib.reload(server)
    return TestClient(server.app)


def test_health_reports_mock_backend(monkeypatch):
    client = _client(monkeypatch)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "stt": "mock", "tts": "mock"}


def test_transcribe_returns_contract_shape(monkeypatch):
    client = _client(monkeypatch)

    response = client.post(
        "/transcribe",
        content=b"not real audio in mock mode",
        headers={"content-type": "audio/webm"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body == {"text": "approve", "confidence": 1.0}
    assert isinstance(body["text"], str)
    assert 0 <= body["confidence"] <= 1


def test_speak_returns_wav_bytes(monkeypatch):
    client = _client(monkeypatch)

    response = client.post("/speak", json={"text": "Ready"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content.startswith(b"RIFF")


def test_speak_can_be_disabled(monkeypatch):
    client = _client(monkeypatch)
    monkeypatch.setenv("VOICE_TTS", "off")

    response = client.post("/speak", json={"text": "Ready"})

    assert response.status_code == 204
    assert response.content == b""
