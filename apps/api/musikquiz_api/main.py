"""HTTP-gränssnittet som webbappen pratar med."""

import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .audio import AudioError, wav_to_mp3
from .library import API_ROOT, DATA_DIR, Library, Song
from .pipeline import Worker

AMBIENCE_DIRS = (API_ROOT / "assets" / "ambience", DATA_DIR / "ambience")
AMBIENCE_SUFFIXES = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}

library = Library(DATA_DIR / "songs")
worker = Worker(library)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Det som inte hann bli klart förra gången börjar om.
    for song in library.all():
        if song.status not in ("ready", "error"):
            library.update(song.id, status="queued", progress=0.0)
            worker.enqueue(song.id)
    worker.start()
    yield


app = FastAPI(title="Musikquiz", lifespan=lifespan)


def _song(song_id: str) -> Song:
    song = library.find(song_id)
    if song is None:
        raise HTTPException(404, "Låten finns inte.")
    return song


@app.get("/api/songs")
def list_songs() -> list[Song]:
    return library.all()


class LinkRequest(BaseModel):
    url: str


@app.post("/api/songs/link")
def add_from_link(request: LinkRequest) -> Song:
    url = request.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Länken måste börja med http:// eller https://.")
    song = library.create(title=url, url=url)
    worker.enqueue(song.id)
    return song


@app.post("/api/songs/upload")
def add_from_file(file: UploadFile) -> Song:
    name = Path(file.filename or "Uppladdad låt")
    song = library.create(title=name.stem)
    # Bara ändelsen tas från det uppladdade namnet, och bara om den är ofarlig.
    suffix = name.suffix if name.suffix[1:].isalnum() else ".bin"
    with open(library.directory(song.id) / f"source{suffix}", "wb") as target:
        shutil.copyfileobj(file.file, target)
    worker.enqueue(song.id)
    return song


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str) -> None:
    song = _song(song_id)
    if song.status in ("downloading", "separating"):
        raise HTTPException(409, "Låten bearbetas. Vänta tills den är klar och ta bort den sedan.")
    library.delete(song_id)


@app.get("/api/songs/{song_id}/stems/{stem}")
def get_stem(song_id: str, stem: Literal["vocals", "drums", "bass", "other"]) -> FileResponse:
    if _song(song_id).status != "ready":
        raise HTTPException(409, "Låten är inte uppdelad än.")
    return FileResponse(library.stem(song_id, stem), media_type="audio/wav")


def _ambience_files() -> dict[str, Path]:
    return {
        path.name: path
        for directory in AMBIENCE_DIRS
        if directory.is_dir()
        for path in sorted(directory.iterdir())
        if path.suffix.lower() in AMBIENCE_SUFFIXES
    }


class Ambience(BaseModel):
    name: str
    url: str


@app.get("/api/ambience")
def list_ambience() -> list[Ambience]:
    return [
        Ambience(name=path.stem, url=f"/api/ambience/{name}")
        for name, path in _ambience_files().items()
    ]


@app.get("/api/ambience/{name}")
def get_ambience(name: str) -> FileResponse:
    path = _ambience_files().get(name)
    if path is None:
        raise HTTPException(404, "Publikljudet finns inte.")
    return FileResponse(path)


@app.post("/api/mp3")
def convert_to_mp3(file: UploadFile) -> Response:
    try:
        mp3 = wav_to_mp3(file.file.read())
    except AudioError as error:
        raise HTTPException(400, f"Klippet gick inte att göra om till mp3. {error}") from error
    return Response(mp3, media_type="audio/mpeg")
