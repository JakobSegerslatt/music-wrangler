export const STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type Stem = (typeof STEMS)[number];

export interface MixSettings {
  /** Volym per spår, 0–1. */
  vocals: number;
  drums: number;
  bass: number;
  other: number;
  /** Bashylla i dB. */
  bassDb: number;
  /** Diskanthylla i dB. */
  trebleDb: number;
  /** 0–1. Skär bort diskanten, som musik genom en vägg. */
  muffle: number;
  /** 0–1. Mono, ingen botten och lite sprucket, som en dålig PA-högtalare. */
  tinny: number;
  /** 0–1. Hur mycket eko som blandas in. */
  reverb: number;
  /** Ekots längd i sekunder. */
  roomSeconds: number;
  /** 0–1. Volym på publiksorlet. */
  crowd: number;
  /** Uppspelningshastighet. Ändrar även tonhöjden. */
  speed: number;
}

export interface Region {
  /** Sekunder in i låten. */
  start: number;
  end: number;
}

export const ORIGINAL: MixSettings = {
  vocals: 1,
  drums: 1,
  bass: 1,
  other: 1,
  bassDb: 0,
  trebleDb: 0,
  muffle: 0,
  tinny: 0,
  reverb: 0,
  roomSeconds: 1.5,
  crowd: 0,
  speed: 1,
};

export interface Preset {
  id: string;
  label: string;
  settings: MixSettings;
}

export const PRESETS: Preset[] = [
  { id: 'original', label: 'Original', settings: ORIGINAL },
  { id: 'no-vocals', label: 'Utan sång', settings: { ...ORIGINAL, vocals: 0 } },
  {
    id: 'beer-tent',
    label: 'Öltält',
    settings: {
      vocals: 0,
      drums: 1,
      bass: 0.8,
      other: 1,
      bassDb: -6,
      trebleDb: -6,
      muffle: 0.25,
      tinny: 0.75,
      reverb: 0.45,
      roomSeconds: 2.4,
      crowd: 0.75,
      speed: 1,
    },
  },
  {
    id: 'club',
    label: 'Klubb',
    settings: {
      vocals: 0,
      drums: 1,
      bass: 1,
      other: 0.8,
      bassDb: 12,
      trebleDb: -8,
      muffle: 0.7,
      tinny: 0,
      reverb: 0.25,
      roomSeconds: 1.2,
      crowd: 0.2,
      speed: 1,
    },
  },
];

export const DEFAULT_CLIP_SECONDS = 15;
