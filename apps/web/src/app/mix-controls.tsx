import { MixSettings, PRESETS } from '../audio/settings';

interface SliderSpec {
  key: keyof MixSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: string;
}

const percent = (value: number) => `${Math.round(value * 100)} %`;
const decibel = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} dB`;

const GROUPS: { title: string; sliders: SliderSpec[] }[] = [
  {
    title: 'Spår',
    sliders: [
      { key: 'vocals', label: 'Sång', min: 0, max: 1, step: 0.01, format: percent },
      { key: 'drums', label: 'Trummor', min: 0, max: 1, step: 0.01, format: percent },
      { key: 'bass', label: 'Bas', min: 0, max: 1, step: 0.01, format: percent },
      { key: 'other', label: 'Övrigt', min: 0, max: 1, step: 0.01, format: percent },
    ],
  },
  {
    title: 'Klang',
    sliders: [
      { key: 'bassDb', label: 'Bas', min: -12, max: 18, step: 1, format: decibel },
      { key: 'trebleDb', label: 'Diskant', min: -24, max: 12, step: 1, format: decibel },
      {
        key: 'muffle',
        label: 'Dovt',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
        hint: 'Som musik genom en vägg',
      },
      {
        key: 'tinny',
        label: 'Burkig högtalare',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
        hint: 'Mono, ingen botten och lite sprucket',
      },
    ],
  },
  {
    title: 'Rum',
    sliders: [
      { key: 'reverb', label: 'Eko', min: 0, max: 1, step: 0.01, format: percent },
      {
        key: 'roomSeconds',
        label: 'Ekots längd',
        min: 0.3,
        max: 5,
        step: 0.1,
        format: (value) => `${value.toFixed(1).replace('.', ',')} s`,
      },
      {
        key: 'crowd',
        label: 'Publiksorl',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
    ],
  },
  {
    title: 'Tempo',
    sliders: [
      {
        key: 'speed',
        label: 'Hastighet',
        min: 0.6,
        max: 1.5,
        step: 0.01,
        format: percent,
        hint: 'Ändrar även tonhöjden',
      },
    ],
  },
];

interface MixControlsProps {
  settings: MixSettings;
  onChange: (settings: MixSettings) => void;
  /** Sätts när det inte finns något publikljud att spela. */
  crowdUnavailable: string | null;
}

export function MixControls({ settings, onChange, crowdUnavailable }: MixControlsProps) {
  return (
    <div className="mix">
      <div className="presets">
        <span className="presets-label">Lägen</span>
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" onClick={() => onChange(preset.settings)}>
            {preset.label}
          </button>
        ))}
      </div>
      <div className="groups">
        {GROUPS.map((group) => (
          <fieldset key={group.title} className="group">
            <legend>{group.title}</legend>
            {group.sliders.map((slider) => {
              const unavailable = slider.key === 'crowd' ? crowdUnavailable : null;
              return (
                <label key={slider.key} className="slider">
                  <span className="slider-head">
                    <span>{slider.label}</span>
                    <output>{slider.format(settings[slider.key])}</output>
                  </span>
                  <input
                    type="range"
                    aria-label={slider.label}
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={settings[slider.key]}
                    disabled={unavailable !== null}
                    onChange={(event) =>
                      onChange({ ...settings, [slider.key]: Number(event.target.value) })
                    }
                  />
                  {(unavailable ?? slider.hint) && (
                    <span className="slider-hint">{unavailable ?? slider.hint}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
