"""Hämtar ljudet och delar upp det i spår. Låtarna bearbetas en i taget i en egen tråd."""

import logging
import queue
import shutil
import threading
from pathlib import Path

import numpy as np

from .audio import FFMPEG, MAX_SECONDS, SAMPLE_RATE, AudioError, decode
from .library import STEMS, Library

log = logging.getLogger("musikquiz")

MODEL = "htdemucs"


class DownloadError(Exception):
    """Länken gick inte att hämta. Meddelandet visas för användaren."""


def download(url: str, directory: Path) -> str:
    """Laddar ner ljudet till directory/source.* och returnerar titeln."""
    import yt_dlp

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(directory / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": FFMPEG,
        # YouTube kräver en JavaScript-motor. Node finns, deno är yt-dlp:s förval.
        "js_runtimes": {"node": {}, "deno": {}},
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                raise DownloadError("Länken går till en spellista. Länka till en enskild låt.")
            if info.get("is_live"):
                raise DownloadError("Länken går till en direktsändning.")
            if (info.get("duration") or 0) > MAX_SECONDS:
                raise DownloadError(f"Klippet är längre än {MAX_SECONDS // 60} minuter.")
            ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as error:
        raise DownloadError(
            f"Det gick inte att hämta ljudet från länken. Ladda upp låten som fil i stället. ({error})"
        ) from error
    return info.get("title") or url


class Worker(threading.Thread):
    def __init__(self, library: Library):
        super().__init__(daemon=True, name="musikquiz-worker")
        self.library = library
        self._queue: queue.Queue[str] = queue.Queue()
        self._separator = None

    def enqueue(self, song_id: str) -> None:
        self._queue.put(song_id)

    def run(self) -> None:
        while True:
            song_id = self._queue.get()
            try:
                self._process(song_id)
            except (DownloadError, AudioError) as error:
                self.library.update(song_id, status="error", error=str(error))
            except Exception as error:
                log.exception("Bearbetningen av %s misslyckades", song_id)
                self.library.update(song_id, status="error", error=f"Oväntat fel: {error}")

    def _process(self, song_id: str) -> None:
        song = self.library.find(song_id)
        if song is None:
            return
        directory = self.library.directory(song_id)

        source = self.library.source(song_id)
        if source is None:
            if song.url is None:
                raise AudioError("Den uppladdade filen finns inte kvar.")
            self.library.update(song_id, status="downloading")
            title = download(song.url, directory)
            self.library.update(song_id, title=title)
            source = self.library.source(song_id)
            if source is None:
                raise DownloadError("Nedladdningen gav ingen fil.")

        self.library.update(song_id, status="separating", progress=0.0)
        samples = decode(source)
        stems = self._separate(
            samples,
            lambda fraction: self.library.update(song_id, persist=False, progress=fraction),
        )

        from demucs.audio import save_audio

        # Skriv till en tillfällig mapp först, så att halvfärdiga spår aldrig ser klara ut.
        unfinished = directory / "stems.tmp"
        shutil.rmtree(unfinished, ignore_errors=True)
        unfinished.mkdir()
        for name in STEMS:
            save_audio(stems[name], unfinished / f"{name}.wav", SAMPLE_RATE, clip="clamp")
        finished = directory / "stems"
        shutil.rmtree(finished, ignore_errors=True)
        unfinished.rename(finished)
        source.unlink()

        self.library.update(
            song_id,
            status="ready",
            progress=1.0,
            duration=samples.shape[1] / SAMPLE_RATE,
        )

    def _separate(self, samples: np.ndarray, on_progress):
        # Importeras först här. PyTorch tar flera sekunder att ladda, och servern ska
        # kunna svara innan dess.
        import torch
        from demucs.api import Separator

        if self._separator is None:
            self._separator = Separator(model=MODEL)

        def callback(info: dict) -> None:
            if info["state"] == "start":
                on_progress(info["segment_offset"] / info["audio_length"])

        self._separator.update_parameter(callback=callback)
        _, stems = self._separator.separate_tensor(torch.from_numpy(samples), SAMPLE_RATE)
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return stems
