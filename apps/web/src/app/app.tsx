import { useCallback, useEffect, useState } from 'react';
import { Player, StemBuffers, computePeaks } from '../audio/engine';
import {
  DEFAULT_CLIP_SECONDS,
  MixSettings,
  ORIGINAL,
  PRESETS,
  Region,
  STEMS,
} from '../audio/settings';
import { encodeWav, normalizePeak } from '../audio/wav';
import {
  Ambience,
  Song,
  convertToMp3,
  fetchAudio,
  fetchStem,
  listAmbience,
  listSongs,
} from './api';
import { MixControls } from './mix-controls';
import { SongPanel } from './song-panel';
import { Waveform } from './waveform';

const player = new Player(ORIGINAL);

const WAVEFORM_BINS = 4000;
const MIN_CLIP_SECONDS = 1;
/** Exporterade klipp toppar på -1 dBFS, så att alla klipp får ungefär samma nivå. */
const EXPORT_PEAK = 0.89;

const LAST_SETTINGS_KEY = 'musikquiz:last-settings';
const AMBIENCE_KEY = 'musikquiz:ambience';
const songKey = (id: string) => `musikquiz:song:${id}`;

/** Det man har ställt in för en låt. Sparas i webbläsaren per låt. */
interface Session {
  songId: string;
  settings: MixSettings;
  region: Region;
  /** Filnamn för exporten. Null betyder låtens titel. */
  clipName: string | null;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; peaks: Float32Array; duration: number };

function readStored<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function restoreSession(songId: string, duration: number): Session {
  const stored = readStored<Session>(songKey(songId));
  const lastUsed = readStored<MixSettings>(LAST_SETTINGS_KEY);
  const beerTent = PRESETS.find((preset) => preset.id === 'beer-tent')!.settings;
  const region = stored?.region ?? {
    start: 0,
    end: Math.min(DEFAULT_CLIP_SECONDS, duration),
  };
  return {
    songId,
    // Nya låtar börjar med det man senast använde, så att en hel omgång får samma ljud.
    settings: { ...ORIGINAL, ...(stored?.settings ?? lastUsed ?? beerTent) },
    region: {
      start: Math.min(region.start, Math.max(0, duration - MIN_CLIP_SECONDS)),
      end: Math.min(region.end, duration),
    },
    clipName: stored?.clipName ?? null,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${rest.replace('.', ',')}`;
}

function toFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'klipp';
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function App() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [original, setOriginal] = useState(false);
  const [ambience, setAmbience] = useState<Ambience[]>([]);
  const [ambienceName, setAmbienceName] = useState(() => localStorage.getItem(AMBIENCE_KEY));
  const [crowdLoaded, setCrowdLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSongs(await listSongs());
      setServerError(null);
    } catch {
      setServerError('Får ingen kontakt med servern. Är den startad?');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fråga servern regelbundet så länge någon låt bearbetas, eller servern inte svarar.
  const waiting =
    serverError !== null ||
    (songs ?? []).some((song) => song.status !== 'ready' && song.status !== 'error');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const selected = songs?.find((song) => song.id === selectedId) ?? null;
  const selectedReady = selected?.status === 'ready';

  // Hämta och avkoda de fyra spåren när en färdig låt väljs.
  useEffect(() => {
    setPlaying(false);
    setOriginal(false);
    setSession(null);
    setExportError(null);
    if (!selectedId || !selectedReady) {
      setLoad({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    (async () => {
      const decoded = await Promise.all(
        STEMS.map(async (stem) =>
          player.ctx.decodeAudioData(await fetchStem(selectedId, stem)),
        ),
      );
      if (cancelled) return;
      const buffers = Object.fromEntries(
        STEMS.map((stem, index) => [stem, decoded[index]]),
      ) as StemBuffers;
      const duration = buffers.vocals.duration;
      player.setBuffers(buffers);
      setSession(restoreSession(selectedId, duration));
      setLoad({
        status: 'ready',
        peaks: computePeaks(buffers, WAVEFORM_BINS),
        duration,
      });
    })().catch((cause) => {
      if (!cancelled) setLoad({ status: 'error', message: errorMessage(cause) });
    });
    return () => {
      cancelled = true;
      player.setBuffers(null);
    };
  }, [selectedId, selectedReady]);

  const settings = session?.settings;
  const region = session?.region;
  useEffect(() => {
    if (region) player.setRegion(region);
  }, [region]);
  useEffect(() => {
    if (settings) player.setSettings(original ? ORIGINAL : settings);
  }, [settings, original]);
  useEffect(() => {
    if (!session) return;
    const { songId, ...stored } = session;
    localStorage.setItem(songKey(songId), JSON.stringify(stored));
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(session.settings));
  }, [session]);

  useEffect(() => {
    listAmbience()
      .then(setAmbience)
      .catch(() => setAmbience([]));
  }, []);

  const activeAmbience =
    ambience.find((item) => item.name === ambienceName) ?? ambience[0] ?? null;
  const ambienceUrl = activeAmbience?.url ?? null;
  useEffect(() => {
    setCrowdLoaded(false);
    player.setCrowd(null);
    if (!ambienceUrl) return;
    let cancelled = false;
    fetchAudio(ambienceUrl)
      .then((data) => player.ctx.decodeAudioData(data))
      .then((buffer) => {
        if (cancelled) return;
        player.setCrowd(buffer);
        setCrowdLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ambienceUrl]);

  const ready = load.status === 'ready' && session !== null;

  const togglePlay = useCallback(() => {
    if (playing) player.stop();
    else void player.play();
    setPlaying(!playing);
  }, [playing]);

  useEffect(() => {
    if (!ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      // Mellanslag i ett textfält eller på en knapp ska göra det vanliga.
      const target = event.target as HTMLElement;
      if (target.closest('input:not([type=range]), button, select, textarea')) return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ready, togglePlay]);

  const getPosition = useCallback(() => (playing ? player.position : null), [playing]);

  const update = (changes: Partial<Session>) =>
    setSession((current) => (current ? { ...current, ...changes } : current));

  const exportClip = async () => {
    if (!session || !selected) return;
    setExporting(true);
    setExportError(null);
    try {
      const rendered = await player.render(session.settings);
      normalizePeak(rendered, EXPORT_PEAK);
      const mp3 = await convertToMp3(encodeWav(rendered));
      download(mp3, `${toFileName(session.clipName ?? selected.title)}.mp3`);
    } catch (cause) {
      setExportError(errorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const crowdUnavailable =
    ambience.length === 0
      ? 'Inget publikljud hittades'
      : crowdLoaded
        ? null
        : 'Laddar publikljudet';

  return (
    <div className="app">
      <SongPanel
        songs={songs}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={(selectId) => {
          void refresh();
          if (selectId) setSelectedId(selectId);
        }}
      />
      <main className="editor">
        {serverError && <p className="error">{serverError}</p>}
        {songs && !selected && (
          <p className="placeholder">Lägg till en låt eller välj en i listan.</p>
        )}
        {selected && !selectedReady && (
          <p className="placeholder">
            {selected.status === 'error'
              ? `Det gick inte att förbereda "${selected.title}". ${selected.error ?? ''}`
              : `"${selected.title}" förbereds. Den går att öppna när spåren är klara.`}
          </p>
        )}
        {load.status === 'loading' && <p className="placeholder">Laddar spåren.</p>}
        {load.status === 'error' && (
          <p className="error">Spåren gick inte att ladda. {load.message}</p>
        )}
        {selected && load.status === 'ready' && session && (
          <>
            <h2>{selected.title}</h2>
            <Waveform
              peaks={load.peaks}
              duration={load.duration}
              region={session.region}
              onRegionChange={(next) => update({ region: next })}
              getPosition={getPosition}
            />
            <p className="hint">
              Dra i vågformen för att markera klippet. Klicka för att flytta det.
            </p>

            <div className="transport">
              <button type="button" className="primary" onClick={togglePlay}>
                {playing ? 'Stoppa' : 'Spela klippet'}
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={original}
                  onChange={(event) => setOriginal(event.target.checked)}
                />
                Lyssna på originalet
              </label>
              <label className="field">
                Start (s)
                <input
                  type="number"
                  min={0}
                  max={load.duration - MIN_CLIP_SECONDS}
                  step={0.5}
                  value={Number(session.region.start.toFixed(1))}
                  onChange={(event) => {
                    const length = session.region.end - session.region.start;
                    const start = Math.max(
                      0,
                      Math.min(Number(event.target.value), load.duration - MIN_CLIP_SECONDS),
                    );
                    update({
                      region: { start, end: Math.min(start + length, load.duration) },
                    });
                  }}
                />
              </label>
              <label className="field">
                Längd (s)
                <input
                  type="number"
                  min={MIN_CLIP_SECONDS}
                  max={load.duration - session.region.start}
                  step={0.5}
                  value={Number((session.region.end - session.region.start).toFixed(1))}
                  onChange={(event) => {
                    const length = Math.max(MIN_CLIP_SECONDS, Number(event.target.value));
                    update({
                      region: {
                        start: session.region.start,
                        end: Math.min(session.region.start + length, load.duration),
                      },
                    });
                  }}
                />
              </label>
              <span className="times">
                {formatTime(session.region.start)} till {formatTime(session.region.end)} av{' '}
                {formatTime(load.duration)}
                {session.settings.speed !== 1 &&
                  `, klippet blir ${(
                    (session.region.end - session.region.start) /
                    session.settings.speed
                  )
                    .toFixed(1)
                    .replace('.', ',')} s`}
              </span>
            </div>

            <div className={original ? 'dimmed' : undefined} inert={original}>
              <MixControls
                settings={session.settings}
                onChange={(next) => update({ settings: next })}
                crowdUnavailable={crowdUnavailable}
              />
              {ambience.length > 1 && (
                <label className="field ambience">
                  Publikljud
                  <select
                    value={activeAmbience?.name}
                    onChange={(event) => {
                      setAmbienceName(event.target.value);
                      localStorage.setItem(AMBIENCE_KEY, event.target.value);
                    }}
                  >
                    {ambience.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="export">
              <label className="field grow">
                Filnamn
                <input
                  type="text"
                  value={session.clipName ?? selected.title}
                  onChange={(event) => update({ clipName: event.target.value })}
                />
              </label>
              <button type="button" className="primary" disabled={exporting} onClick={exportClip}>
                {exporting ? 'Exporterar' : 'Exportera mp3'}
              </button>
            </div>
            {exportError && <p className="error">Exporten misslyckades. {exportError}</p>}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
