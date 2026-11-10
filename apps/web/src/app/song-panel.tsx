import { FormEvent, useRef, useState } from 'react';
import { Song, addFromFile, addFromLink, deleteSong } from './api';

function statusText(song: Song): string {
  switch (song.status) {
    case 'queued':
      return 'Väntar på sin tur';
    case 'downloading':
      return 'Hämtar ljudet';
    case 'separating':
      return `Delar upp i spår, ${Math.round(song.progress * 100)} %`;
    case 'ready':
      return 'Klar';
    case 'error':
      return song.error ?? 'Något gick fel';
  }
}

interface SongPanelProps {
  /** Null tills listan har hämtats första gången. */
  songs: Song[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Anropas när en låt har lagts till eller tagits bort. */
  onChanged: (selectId?: string) => void;
}

export function SongPanel({ songs, selectedId, onSelect, onChanged }: SongPanelProps) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const add = async (request: Promise<Song>) => {
    setBusy(true);
    setError(null);
    try {
      const song = await request;
      setLink('');
      onChanged(song.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    if (link.trim()) void add(addFromLink(link.trim()));
  };

  const remove = async (song: Song) => {
    if (!window.confirm(`Ta bort "${song.title}"?`)) return;
    try {
      await deleteSong(song.id);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <aside className="songs">
      <h1>Musikquiz</h1>
      <form className="add" onSubmit={submitLink}>
        <label htmlFor="link">Lägg till en låt</label>
        <div className="add-row">
          <input
            id="link"
            type="url"
            placeholder="Klistra in en YouTube-länk"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !link.trim()}>
            Hämta
          </button>
        </div>
        <button type="button" className="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>
          Eller ladda upp en ljudfil
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void add(addFromFile(file));
          }}
        />
        {error && <p className="error">{error}</p>}
      </form>

      {songs === null ? null : songs.length === 0 ? (
        <p className="empty">Inga låtar än.</p>
      ) : (
        <ul className="song-list">
          {songs.map((song) => (
            <li key={song.id} className={song.id === selectedId ? 'song selected' : 'song'}>
              <button type="button" className="song-main" onClick={() => onSelect(song.id)}>
                <span className="song-title">{song.title}</span>
                <span className={song.status === 'error' ? 'song-status error' : 'song-status'}>
                  {statusText(song)}
                </span>
                {song.status === 'separating' && (
                  <progress value={song.progress} max={1} />
                )}
              </button>
              <button
                type="button"
                className="song-remove"
                aria-label={`Ta bort ${song.title}`}
                title="Ta bort"
                onClick={() => void remove(song)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
