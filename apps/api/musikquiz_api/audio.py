"""Läsning och konvertering av ljud med den ffmpeg som följer med imageio-ffmpeg."""

import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SAMPLE_RATE = 44100
MAX_SECONDS = 20 * 60


class AudioError(Exception):
    """Ljudet gick inte att läsa eller konvertera. Meddelandet visas för användaren."""


def _run(arguments: list[str], input: bytes | None = None) -> bytes:
    result = subprocess.run([FFMPEG, "-v", "error", *arguments], input=input, capture_output=True)
    if result.returncode != 0:
        # ffmpeg skriver flera rader. Den sista sammanfattar felet.
        lines = result.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise AudioError(lines[-1] if lines else "ffmpeg misslyckades utan felmeddelande.")
    return result.stdout


def decode(path: Path) -> np.ndarray:
    """Läser första ljudspåret i filen som stereo i 44,1 kHz. Formen är [2, antal sampel]."""
    try:
        # Läs högst en sekund över gränsen, så att en timslång fil inte fyller minnet.
        raw = _run(
            ["-i", str(path), "-vn", "-map", "0:a:0", "-t", str(MAX_SECONDS + 1),
             "-ac", "2", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
        )
    except AudioError as error:
        raise AudioError(f"Filen gick inte att läsa som ljud. {error}") from error
    samples = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).T
    if samples.shape[1] == 0:
        raise AudioError("Filen innehåller inget ljud.")
    if samples.shape[1] > MAX_SECONDS * SAMPLE_RATE:
        raise AudioError(f"Ljudet är längre än {MAX_SECONDS // 60} minuter.")
    return samples.copy()


def wav_to_mp3(wav: bytes) -> bytes:
    return _run(
        ["-f", "wav", "-i", "pipe:0", "-codec:a", "libmp3lame", "-q:a", "2", "-f", "mp3", "pipe:1"],
        input=wav,
    )
