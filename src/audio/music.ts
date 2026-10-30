/**
 * The match's music bed and ambience, synthesised like every other sound (`audioEngine.ts`): no
 * files, nothing licensed.
 *
 * **Music** is a step sequencer: a goofy marching-band loop of kick, snare, hat, tuba-ish bass and
 * a brass stab, in three layers that come in with `intensity`. Notes are scheduled a little ahead
 * on the audio clock (`LOOKAHEAD_S`) from a coarse timer, the standard WebAudio pattern, so the
 * beat stays steady however the main thread stutters.
 *
 * **Ambience** is a wind bed (looped noise through a slowly wandering low-pass), birdsong chirps
 * and a distant crowd murmur.
 *
 * `musicIntensity` is the one rule worth asserting and is pure; the rest is sound.
 */

/** Steps per bar (sixteenths) and the loop's length in bars. */
const STEPS = 16;
const BARS = 4;
const LOOKAHEAD_S = 0.12;
const TIMER_MS = 30;
/** Beats per minute: a jaunty march, pushed for the final stretch. */
const BPM = 116;
const BPM_FINAL = 136;

// One bar per row, sixteenths. x = hit.
const KICK = "x.......x.......";
const SNARE = "....x.......x.xx";
const HAT = "x.x.x.x.x.x.x.x.";
const ROLL = "....x.x.x.xxxxxx";
/** Bass: semitones from the root per sixteenth, '.' for rest; one row per bar. */
const BASS = [
  [0, null, null, null, 7, null, null, null, 0, null, null, null, 7, null, 5, null],
  [5, null, null, null, 12, null, null, null, 5, null, null, null, 4, null, 2, null],
  [0, null, null, null, 7, null, null, null, 0, null, null, null, 7, null, 9, null],
  [7, null, null, null, 7, null, 5, null, 4, null, 2, null, 0, null, null, null],
] as const;
/** Brass stabs: chord roots per beat on the top layer only. */
const STABS = [
  [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 7, null],
  [5, null, null, null, null, null, null, null, 5, null, null, null, 4, null, null, null],
  [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 9, null],
  [7, null, null, null, 7, null, null, null, 7, null, 7, null, 12, null, null, null],
] as const;
const ROOT_HZ = 55 * Math.pow(2, 3 / 12); // C2

export interface IntensityInput {
  /** The player's side or the other made a kill within the last ten seconds: how many. */
  readonly recentKills: number;
  /** Seconds left on the clock. */
  readonly remaining: number;
  readonly live: boolean;
}

/**
 * 0..1. Calm patrol at the start, rising with every recent kill, and pinned to the top in the
 * final 30 seconds. Nothing at all before FORE! or after the buzzer.
 */
export function musicIntensity(input: IntensityInput): number {
  if (!input.live) return 0;
  if (input.remaining <= 30) return 1;
  return Math.min(1, 0.25 + 0.18 * input.recentKills);
}

export class MusicBed {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private intensity = 0;
  private finalStretch = false;
  private ambience: AmbienceNodes | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly music: AudioNode,
    private readonly sfx: AudioNode,
    private readonly noise: AudioBuffer,
  ) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.startAmbience();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopAmbience();
  }

  set(intensity: number, finalStretch: boolean): void {
    this.intensity = intensity;
    this.finalStretch = finalStretch;
  }

  private schedule(): void {
    const ctx = this.ctx;
    // A suspended context (tab hidden) leaves currentTime still; don't pile notes up behind it.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.step, this.nextTime);
      const bpm = this.finalStretch ? BPM_FINAL : BPM;
      this.nextTime += 60 / bpm / 4;
      this.step = (this.step + 1) % (STEPS * BARS);
    }
  }

  private playStep(step: number, t: number): void {
    const level = this.intensity;
    if (level <= 0) return;
    const s = step % STEPS;
    const bar = Math.floor(step / STEPS);
    const out = this.music;
    if (KICK[s] === "x") kick(this.ctx, out, t, 0.5);
    if (HAT[s] === "x") hat(this.ctx, out, this.noise, t, 0.05 + 0.05 * level);
    if (level >= 0.4) {
      const pattern = bar === BARS - 1 && level >= 0.7 ? ROLL : SNARE;
      if (pattern[s] === "x") snare(this.ctx, out, this.noise, t, 0.22);
      const note = BASS[bar]![s];
      if (note !== null && note !== undefined) bass(this.ctx, out, ROOT_HZ * Math.pow(2, note / 12), t, 0.3);
    }
    if (level >= 0.75) {
      const root = STABS[bar]![s];
      if (root !== null && root !== undefined) stab(this.ctx, out, ROOT_HZ * 4 * Math.pow(2, root / 12), t, 0.09);
    }
  }

  private startAmbience(): void {
    if (this.ambience) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    gain.connect(this.sfx);
    // Wind: noise through a low-pass whose cutoff an LFO slowly wanders.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(windFilter.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(gain);
    // A far crowd: band-passed noise, very quiet.
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noise;
    crowd.loop = true;
    crowd.playbackRate.value = 0.6;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 700;
    crowdFilter.Q.value = 0.8;
    const crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.018;
    crowd.connect(crowdFilter).connect(crowdGain).connect(gain);
    wind.start();
    crowd.start();
    lfo.start();
    const birds = setInterval(() => {
      if (Math.random() < 0.55) chirp(ctx, gain, ctx.currentTime + Math.random() * 0.3);
    }, 2200);
    this.ambience = { gain, sources: [wind, crowd, lfo], birds };
  }

  private stopAmbience(): void {
    const a = this.ambience;
    if (!a) return;
    this.ambience = null;
    clearInterval(a.birds);
    const t = this.ctx.currentTime;
    a.gain.gain.setTargetAtTime(0, t, 0.3);
    for (const source of a.sources) source.stop(t + 1.5);
    setTimeout(() => a.gain.disconnect(), 1800);
  }
}

interface AmbienceNodes {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  birds: ReturnType<typeof setInterval>;
}

function envelope(ctx: AudioContext, out: AudioNode, t: number, peak: number, length: number): GainNode {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  env.connect(out);
  return env;
}

function kick(ctx: AudioContext, out: AudioNode, t: number, peak: number): void {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  osc.connect(envelope(ctx, out, t, peak, 0.18));
  osc.start(t);
  osc.stop(t + 0.2);
}

function noiseHit(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number, type: BiquadFilterType, hz: number, peak: number, length: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  src.connect(filter).connect(envelope(ctx, out, t, peak, length));
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

function snare(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number, peak: number): void {
  noiseHit(ctx, out, noise, t, "bandpass", 1800, peak, 0.12);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 190;
  osc.connect(envelope(ctx, out, t, peak * 0.5, 0.08));
  osc.start(t);
  osc.stop(t + 0.1);
}

function hat(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number, peak: number): void {
  noiseHit(ctx, out, noise, t, "highpass", 7000, peak, 0.04);
}

/** A round, slightly buzzy tuba note. */
function bass(ctx: AudioContext, out: AudioNode, hz: number, t: number, peak: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = hz;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = hz * 4;
  osc.connect(filter).connect(envelope(ctx, out, t, peak, 0.22));
  osc.start(t);
  osc.stop(t + 0.25);
}

/** A short brass-section stab: root, third and fifth on detuned saws. */
function stab(ctx: AudioContext, out: AudioNode, hz: number, t: number, peak: number): void {
  for (const ratio of [1, 1.26, 1.5]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz * ratio;
    osc.detune.value = (Math.random() - 0.5) * 12;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    osc.connect(filter).connect(envelope(ctx, out, t, peak, 0.16));
    osc.start(t);
    osc.stop(t + 0.18);
  }
}

/** A two-note songbird chirp. */
function chirp(ctx: AudioContext, out: AudioNode, t: number): void {
  const base = 2600 + Math.random() * 1400;
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
    const at = t + i * 0.11;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(base, at);
    osc.frequency.exponentialRampToValueAtTime(base * 1.35, at + 0.06);
    osc.connect(envelope(ctx, out, at, 0.025, 0.08));
    osc.start(at);
    osc.stop(at + 0.1);
  }
}
