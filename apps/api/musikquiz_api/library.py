"""Låtarna på disk. Varje låt har en egen mapp med meta.json, källfil och uppdelade spår."""

import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
DATA_DIR = Path(os.environ.get("MUSIKQUIZ_DATA", REPO_ROOT / "data"))

Status = Literal["queued", "downloading", "separating", "ready", "error"]
STEMS = ("vocals", "drums", "bass", "other")


class Song(BaseModel):
    id: str
    title: str
    status: Status = "queued"
    progress: float = 0.0
    error: str | None = None
    duration: float | None = None
    url: str | None = None
    created: float


class Library:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._songs: dict[str, Song] = {}
        for meta in self.root.glob("*/meta.json"):
            song = Song.model_validate_json(meta.read_text(encoding="utf-8"))
            self._songs[song.id] = song

    def directory(self, song_id: str) -> Path:
        return self.root / song_id

    def source(self, song_id: str) -> Path | None:
        """Den nedladdade eller uppladdade filen, om den finns kvar."""
        return next(iter(self.directory(song_id).glob("source.*")), None)

    def stem(self, song_id: str, stem: str) -> Path:
        return self.directory(song_id) / "stems" / f"{stem}.wav"

    def all(self) -> list[Song]:
        with self._lock:
            return sorted(self._songs.values(), key=lambda song: song.created)

    def find(self, song_id: str) -> Song | None:
        with self._lock:
            return self._songs.get(song_id)

    def create(self, title: str, url: str | None = None) -> Song:
        song = Song(id=uuid.uuid4().hex, title=title, url=url, created=time.time())
        self.directory(song.id).mkdir()
        with self._lock:
            self._songs[song.id] = song
            self._write(song)
        return song

    def update(self, song_id: str, persist: bool = True, **changes) -> None:
        """Ändrar en låt. Gör ingenting om låten har tagits bort under tiden."""
        with self._lock:
            song = self._songs.get(song_id)
            if song is None:
                return
            song = song.model_copy(update=changes)
            self._songs[song_id] = song
            if persist:
                self._write(song)

    def delete(self, song_id: str) -> None:
        with self._lock:
            self._songs.pop(song_id, None)
        shutil.rmtree(self.directory(song_id), ignore_errors=True)

    def _write(self, song: Song) -> None:
        meta = self.directory(song.id) / "meta.json"
        meta.write_text(song.model_dump_json(indent=2), encoding="utf-8")
