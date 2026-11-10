# Musikquiz

Gör musikklipp som är svårare att känna igen. Appen hämtar en låt från en YouTube-länk eller en uppladdad fil, delar upp den i sång, trummor, bas och övrigt, och låter dig ta bort sången och lägga på eko, publiksorl och annat innan klippet exporteras som mp3.

## Köra

```sh
npm start
```

Öppna sedan <http://localhost:4200>. Kommandot startar både servern (port 8000) och webbappen (port 4200).

## Installera på en ny dator

Kräver Windows, Node, Python 3.11 och ett Nvidia-grafikkort. Utan grafikkort körs uppdelningen på processorn, vilket är otestat och betydligt långsammare.

```sh
npm install
npm run setup
```

`npm run setup` skapar `apps/api/.venv` och installerar PyTorch, Demucs, yt-dlp och ffmpeg där. Det är drygt 4 GB. Första gången en låt delas upp laddas också Demucs-modellen ner till `~/.cache/huggingface`.

## Upplägg

Repot är en Nx-monorepo med två projekt.

| Projekt | Mapp | Innehåll |
| --- | --- | --- |
| `web` | `apps/web` | React-appen. Effekterna körs i webbläsaren med Web Audio, se `src/audio/engine.ts`. |
| `api` | `apps/api` | Python-servern (FastAPI). Hämtar ljud med yt-dlp och delar upp det med Demucs. |

Låtar och uppdelade spår sparas i `data/songs`, som inte följer med i git. En låt tar ungefär 40 MB per minut.

## Om YouTube slutar fungera

YouTube ändras ofta, och då behöver yt-dlp uppdateras:

```sh
apps\api\.venv\Scripts\python.exe -m pip install --upgrade "yt-dlp[default]"
```

Går det ändå inte, ladda upp låten som fil i stället.

## Egna publikljud

Lägg ljudfiler i `data/ambience`. De dyker upp i listan Publikljud när sidan laddas om. De två som följer med beskrivs i `apps/api/assets/ambience/README.md`.
