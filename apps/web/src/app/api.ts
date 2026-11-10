import { Stem } from '../audio/settings';

export type SongStatus =
  | 'queued'
  | 'downloading'
  | 'separating'
  | 'ready'
  | 'error';

export interface Song {
  id: string;
  title: string;
  status: SongStatus;
  /** Andel av uppdelningen som är klar, 0–1. */
  progress: number;
  error: string | null;
  duration: number | null;
}

export interface Ambience {
  name: string;
  url: string;
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `Servern svarade ${response.status}.`;
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') message = body.detail;
  } catch {
    // Svaret var inte JSON. Statuskoden får räcka.
  }
  throw new Error(message);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  return (await check(await fetch(url, init))).json();
}

export function listSongs(): Promise<Song[]> {
  return getJson('/api/songs');
}

export function addFromLink(url: string): Promise<Song> {
  return getJson('/api/songs/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function addFromFile(file: File): Promise<Song> {
  const body = new FormData();
  body.append('file', file);
  return getJson('/api/songs/upload', { method: 'POST', body });
}

export async function deleteSong(id: string): Promise<void> {
  await check(await fetch(`/api/songs/${id}`, { method: 'DELETE' }));
}

export async function fetchStem(id: string, stem: Stem): Promise<ArrayBuffer> {
  return (await check(await fetch(`/api/songs/${id}/stems/${stem}`))).arrayBuffer();
}

export function listAmbience(): Promise<Ambience[]> {
  return getJson('/api/ambience');
}

export async function fetchAudio(url: string): Promise<ArrayBuffer> {
  return (await check(await fetch(url))).arrayBuffer();
}

/** Skickar ett WAV-klipp till servern och får tillbaka det som mp3. */
export async function convertToMp3(wav: Blob): Promise<Blob> {
  const body = new FormData();
  body.append('file', wav, 'clip.wav');
  return (await check(await fetch('/api/mp3', { method: 'POST', body }))).blob();
}
