from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


class PiperSpeaker:
    """Piper command-line boundary.

    The wrapper writes text to stdin and asks Piper to create a temporary WAV
    file. The Piper binary and voice model stay outside this repo so the
    service remains small and CI does not require native audio/model
    dependencies.
    """

    def __init__(self) -> None:
        self.piper_bin = os.environ.get("PIPER_BIN", "piper")
        self.model = os.environ.get("PIPER_MODEL")
        self.config = os.environ.get("PIPER_CONFIG")

    def speak(self, text: str) -> bytes:
        if not self.model:
            raise RuntimeError("PIPER_MODEL is required for real TTS, or set VOICE_TTS=off.")

        output = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        output_path = Path(output.name)
        output.close()

        command = [self.piper_bin, "--model", self.model, "--output_file", str(output_path)]
        if self.config:
            command.extend(["--config", self.config])

        try:
            subprocess.run(
                command,
                input=text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        except FileNotFoundError as exc:
            _remove_if_present(output_path)
            raise RuntimeError(
                "Piper binary was not found. Install Piper or set PIPER_BIN."
            ) from exc
        except subprocess.CalledProcessError as exc:
            _remove_if_present(output_path)
            detail = exc.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Piper failed: {detail}") from exc

        wav = output_path.read_bytes()
        _remove_if_present(output_path)

        if not wav.startswith(b"RIFF"):
            raise RuntimeError(
                "Piper did not write WAV bytes. Check the Piper CLI flags "
                "for the installed version."
            )

        return wav


def _remove_if_present(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
