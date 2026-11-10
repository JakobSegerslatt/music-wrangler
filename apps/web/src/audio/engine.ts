import { MixSettings, Region, Stem, STEMS } from './settings';

export type StemBuffers = Record<Stem, AudioBuffer>;

const FADE_IN_SECONDS = 0.02;
const FADE_OUT_SECONDS = 0.5;

/** Styrka på de effekter som inte har ett eget reglage. */
const TUNING = {
  bassShelfHz: 120,
  trebleShelfHz: 4000,
  tinnyHighpassMaxHz: 600,
  tinnyHonkHz: 1400,
  tinnyHonkMaxDb: 9,
  muffleMinHz: 220,
  distortionDrive: 4,
  /** Förvrängningen förstärker svaga partier. Det här drar ner den till ungefär samma nivå som det rena ljudet. */
  distortionLevel: 0.45,
  reverbWetGain: 2.4,
  crowdGain: 1.4,
  masterGain: 0.8,
  /** Alla låtar skalas till den här medelnivån före effekterna, så att lägena låter lika på starka och svaga inspelningar. */
  musicRms: 0.1,
};

/**
 * Effektkedjan. Samma kedja byggs för uppspelning och för export, så att det
 * exporterade klippet låter som det man hörde.
 */
interface Graph {
  ctx: BaseAudioContext;
  stemGains: Record<Stem, GainNode>;
  musicGain: GainNode;
  stereoGain: GainNode;
  monoGain: GainNode;
  lowShelf: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  highpassA: BiquadFilterNode;
  highpassB: BiquadFilterNode;
  honk: BiquadFilterNode;
  lowpassA: BiquadFilterNode;
  lowpassB: BiquadFilterNode;
  cleanGain: GainNode;
  distortedGain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  convolver: ConvolverNode;
  crowdGain: GainNode;
  output: AudioNode;
  impulseSeconds: number | null;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ett konstgjort rumseko: brus som klingar av 60 dB på `seconds` och blir
 * mörkare mot slutet. Fast slumpfrö, så att export och uppspelning får samma eko.
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const preDelay = Math.floor(rate * 0.012);
  const length = preDelay + Math.ceil(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const random = mulberry32(1000 + c);
    const data = impulse.getChannelData(c);
    let smoothed = 0;
    for (let i = preDelay; i < length; i++) {
      const progress = (i - preDelay) / (length - preDelay);
      const brightness = 0.7 - 0.6 * progress;
      smoothed += brightness * (random() * 2 - 1 - smoothed);
      data[i] = smoothed * Math.pow(10, -3 * progress);
    }
  }
  return impulse;
}

function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const scale = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / scale;
  }
  return curve;
}

function buildGraph(ctx: BaseAudioContext): Graph {
  const bus = ctx.createGain();
  const stemGains = {} as Record<Stem, GainNode>;
  for (const stem of STEMS) {
    stemGains[stem] = ctx.createGain();
    stemGains[stem].connect(bus);
  }

  // Stereo och mono parallellt, så att reglaget kan tona mellan dem.
  const stereoGain = ctx.createGain();
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  const monoGain = ctx.createGain();
  bus.connect(stereoGain);
  bus.connect(mono);
  mono.connect(monoGain);

  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = TUNING.bassShelfHz;
  const highShelf = ctx.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = TUNING.trebleShelfHz;
  // Två filter i rad ger en brantare kant än ett.
  const highpassA = ctx.createBiquadFilter();
  highpassA.type = 'highpass';
  highpassA.Q.value = 0.7;
  const highpassB = ctx.createBiquadFilter();
  highpassB.type = 'highpass';
  highpassB.Q.value = 0.7;
  const honk = ctx.createBiquadFilter();
  honk.type = 'peaking';
  honk.frequency.value = TUNING.tinnyHonkHz;
  honk.Q.value = 0.9;
  const lowpassA = ctx.createBiquadFilter();
  lowpassA.type = 'lowpass';
  lowpassA.Q.value = 0.7;
  const lowpassB = ctx.createBiquadFilter();
  lowpassB.type = 'lowpass';
  lowpassB.Q.value = 0.7;

  stereoGain.connect(lowShelf);
  monoGain.connect(lowShelf);
  lowShelf
    .connect(highShelf)
    .connect(highpassA)
    .connect(highpassB)
    .connect(honk)
    .connect(lowpassA)
    .connect(lowpassB);

  // Rent och förvrängt parallellt. Utan översampling, annars hamnar den
  // förvrängda vägen efter den rena och de släcker ut varandra.
  const cleanGain = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(TUNING.distortionDrive);
  shaper.oversample = 'none';
  const distortedGain = ctx.createGain();
  const effected = ctx.createGain();
  lowpassB.connect(cleanGain).connect(effected);
  lowpassB.connect(shaper).connect(distortedGain).connect(effected);

  const master = ctx.createGain();
  master.gain.value = TUNING.masterGain;
  const dryGain = ctx.createGain();
  const convolver = ctx.createConvolver();
  const wetGain = ctx.createGain();
  effected.connect(dryGain).connect(master);
  effected.connect(convolver).connect(wetGain).connect(master);

  const crowdGain = ctx.createGain();
  crowdGain.connect(master);

  // Begränsare sist, så att basförstärkning och sorl inte klipper.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter);

  return {
    ctx,
    stemGains,
    musicGain: bus,
    stereoGain,
    monoGain,
    lowShelf,
    highShelf,
    highpassA,
    highpassB,
    honk,
    lowpassA,
    lowpassB,
    cleanGain,
    distortedGain,
    dryGain,
    wetGain,
    convolver,
    crowdGain,
    output: limiter,
    impulseSeconds: null,
  };
}

/** `smooth` glider till de nya värdena, så att reglage inte knäpper under uppspelning. */
function applySettings(graph: Graph, s: MixSettings, smooth: boolean): void {
  const { ctx } = graph;
  const set = (param: AudioParam, value: number) => {
    if (smooth) param.setTargetAtTime(value, ctx.currentTime, 0.015);
    else param.value = value;
  };

  for (const stem of STEMS) set(graph.stemGains[stem].gain, s[stem]);

  set(graph.stereoGain.gain, 1 - s.tinny);
  set(graph.monoGain.gain, s.tinny);
  set(graph.lowShelf.gain, s.bassDb);
  set(graph.highShelf.gain, s.trebleDb);
  const highpassHz = 20 * Math.pow(TUNING.tinnyHighpassMaxHz / 20, s.tinny);
  set(graph.highpassA.frequency, highpassHz);
  set(graph.highpassB.frequency, highpassHz);
  set(graph.honk.gain, TUNING.tinnyHonkMaxDb * s.tinny);

  const openHz = Math.min(20000, ctx.sampleRate * 0.45);
  const lowpassHz = openHz * Math.pow(TUNING.muffleMinHz / openHz, s.muffle);
  set(graph.lowpassA.frequency, lowpassHz);
  set(graph.lowpassB.frequency, lowpassHz);

  set(graph.cleanGain.gain, 1 - s.tinny);
  set(graph.distortedGain.gain, TUNING.distortionLevel * s.tinny);

  set(graph.dryGain.gain, 1 - 0.5 * s.reverb);
  set(graph.wetGain.gain, TUNING.reverbWetGain * s.reverb);
  if (graph.impulseSeconds !== s.roomSeconds) {
    graph.convolver.buffer = makeImpulse(ctx, s.roomSeconds);
    graph.impulseSeconds = s.roomSeconds;
  }

  set(graph.crowdGain.gain, TUNING.crowdGain * s.crowd);
}

interface Sources {
  stems: AudioBufferSourceNode[];
  crowd: AudioBufferSourceNode | null;
}

function startSources(
  graph: Graph,
  buffers: StemBuffers,
  crowd: AudioBuffer | null,
  settings: MixSettings,
  region: Region,
  when: number,
  loop: boolean,
): Sources {
  const { ctx } = graph;
  const sources: Sources = { stems: [], crowd: null };
  for (const stem of STEMS) {
    const source = ctx.createBufferSource();
    source.buffer = buffers[stem];
    source.playbackRate.value = settings.speed;
    source.connect(graph.stemGains[stem]);
    if (loop) {
      source.loop = true;
      source.loopStart = region.start;
      source.loopEnd = region.end;
      source.start(when, region.start);
    } else {
      source.start(when, region.start, region.end - region.start);
    }
    sources.stems.push(source);
  }
  if (crowd) {
    const source = ctx.createBufferSource();
    source.buffer = crowd;
    source.loop = true;
    source.connect(graph.crowdGain);
    source.start(when);
    sources.crowd = source;
  }
  return sources;
}

/**
 * Förstärkningen som ger låten medelnivån `TUNING.musicRms`. Mäts på hela låten,
 * på summan av spårens vänsterkanaler.
 */
export function measureMusicGain(buffers: StemBuffers): number {
  const channels = STEMS.map((stem) => buffers[stem].getChannelData(0));
  const stride = 4;
  let squares = 0;
  let count = 0;
  for (let i = 0; i < channels[0].length; i += stride) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    squares += sum * sum;
    count++;
  }
  const rms = Math.sqrt(squares / count);
  return rms > 0 ? TUNING.musicRms / rms : 1;
}

/** Renderar klippet till en buffert, med kort intoning och uttoning. */
export async function renderClip(
  buffers: StemBuffers,
  crowd: AudioBuffer | null,
  settings: MixSettings,
  region: Region,
  sampleRate: number,
  musicGain: number,
): Promise<AudioBuffer> {
  const seconds = (region.end - region.start) / settings.speed;
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(seconds * sampleRate),
    sampleRate,
  );
  const graph = buildGraph(ctx);
  graph.musicGain.gain.value = musicGain;
  applySettings(graph, settings, false);

  const fade = ctx.createGain();
  const fadeOut = Math.min(FADE_OUT_SECONDS, seconds / 4);
  fade.gain.setValueAtTime(0, 0);
  fade.gain.linearRampToValueAtTime(1, FADE_IN_SECONDS);
  fade.gain.setValueAtTime(1, seconds - fadeOut);
  fade.gain.linearRampToValueAtTime(0, seconds);
  graph.output.connect(fade).connect(ctx.destination);

  startSources(graph, buffers, crowd, settings, region, 0, false);
  return ctx.startRendering();
}

/** Spelar upp det markerade avsnittet i en slinga, med effekterna pålagda. */
export class Player {
  readonly ctx = new AudioContext();
  private readonly graph = buildGraph(this.ctx);
  private buffers: StemBuffers | null = null;
  private musicGain = 1;
  private crowd: AudioBuffer | null = null;
  private settings: MixSettings;
  private region: Region = { start: 0, end: 0 };
  private sources: Sources | null = null;
  /** Låtposition `anchorPosition` gällde vid kontexttiden `anchorTime`. */
  private anchorTime = 0;
  private anchorPosition = 0;
  private playRequest = 0;

  constructor(settings: MixSettings) {
    this.settings = settings;
    this.graph.output.connect(this.ctx.destination);
    applySettings(this.graph, settings, false);
  }

  get playing(): boolean {
    return this.sources !== null;
  }

  /** Aktuell position i låten, i sekunder. */
  get position(): number {
    const { start, end } = this.region;
    if (!this.playing) return start;
    const elapsed =
      Math.max(0, this.ctx.currentTime - this.anchorTime) * this.settings.speed;
    return start + ((this.anchorPosition - start + elapsed) % (end - start));
  }

  setBuffers(buffers: StemBuffers | null): void {
    this.stop();
    this.buffers = buffers;
    this.musicGain = buffers ? measureMusicGain(buffers) : 1;
    this.graph.musicGain.gain.value = this.musicGain;
  }

  setCrowd(crowd: AudioBuffer | null): void {
    this.crowd = crowd;
    if (this.playing) void this.play();
  }

  setSettings(settings: MixSettings): void {
    if (this.sources && settings.speed !== this.settings.speed) {
      const now = this.ctx.currentTime;
      this.anchorPosition = this.position;
      this.anchorTime = now;
      for (const source of this.sources.stems) {
        source.playbackRate.setValueAtTime(settings.speed, now);
      }
    }
    this.settings = settings;
    applySettings(this.graph, settings, true);
  }

  setRegion(region: Region): void {
    const changed =
      region.start !== this.region.start || region.end !== this.region.end;
    this.region = region;
    if (changed && this.playing) void this.play();
  }

  async play(): Promise<void> {
    if (!this.buffers || this.region.end <= this.region.start) return;
    // Ett senare play() eller stop() under väntan gör det här anropet inaktuellt.
    const request = ++this.playRequest;
    await this.ctx.resume();
    if (request !== this.playRequest) return;
    this.stopSources();
    const when = this.ctx.currentTime + 0.03;
    this.sources = startSources(
      this.graph,
      this.buffers,
      this.crowd,
      this.settings,
      this.region,
      when,
      true,
    );
    this.anchorTime = when;
    this.anchorPosition = this.region.start;
  }

  stop(): void {
    this.playRequest++;
    this.stopSources();
  }

  private stopSources(): void {
    if (!this.sources) return;
    for (const source of [...this.sources.stems, this.sources.crowd]) {
      source?.stop();
      source?.disconnect();
    }
    this.sources = null;
  }

  /** Renderar det markerade avsnittet med de givna inställningarna. */
  render(settings: MixSettings): Promise<AudioBuffer> {
    if (!this.buffers) throw new Error('Ingen låt är laddad.');
    return renderClip(
      this.buffers,
      this.crowd,
      settings,
      this.region,
      this.ctx.sampleRate,
      this.musicGain,
    );
  }
}

/** Toppvärden för vågformen: högsta utslaget i varje av `bins` lika breda delar. */
export function computePeaks(buffers: StemBuffers, bins: number): Float32Array {
  const length = buffers.vocals.length;
  const channels = STEMS.map((stem) => buffers[stem].getChannelData(0));
  const peaks = new Float32Array(bins);
  const binSize = length / bins;
  // Vart åttonde sampel räcker gott för en bild och går åtta gånger fortare.
  const stride = 8;
  for (let bin = 0; bin < bins; bin++) {
    const from = Math.floor(bin * binSize);
    const to = Math.min(length, Math.floor((bin + 1) * binSize));
    let max = 0;
    for (let i = from; i < to; i += stride) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      const value = Math.abs(sum);
      if (value > max) max = value;
    }
    peaks[bin] = max;
  }
  return peaks;
}
