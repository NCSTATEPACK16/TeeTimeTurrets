import type { Cue, CuePlay } from "./audioDirector";

/**
 * All of the game's sound, synthesised with WebAudio: no audio files ship, so nothing is loaded
 * and nothing is licensed.
 *
 * Three buses: every sound goes through `sfx` or `music`, both into `master`, which goes to the
 * speakers. Settings (volume, mute) act on the buses. Music has no content yet; the bus exists so
 * Settings can own its level from the start.
 *
 * One engine for the page (`gameAudio`), because a page gets a handful of AudioContexts at most
 * and each screen would otherwise make its own. The context is created on the first user gesture
 * (`unlock`), because browsers refuse to start one before that. Until then every call is a no-op.
 */

export interface BusLevels {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

export const DEFAULT_LEVELS: Readonly<BusLevels> = { master: 0.8, sfx: 1, music: 0.5, muted: false };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private levels: BusLevels = { ...DEFAULT_LEVELS };
  private engineOsc: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Creates or resumes the context. Call from a user gesture. */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.sfx = ctx.createGain();
      this.music = ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(ctx.destination);
      this.noise = makeNoise(ctx);
      this.applyLevels();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setLevels(levels: BusLevels): void {
    this.levels = { ...levels };
    this.applyLevels();
  }

  getLevels(): BusLevels {
    return { ...this.levels };
  }

  play(p: CuePlay): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== "running") return;
    const out = ctx.createStereoPanner();
    out.pan.value = p.pan;
    const gain = ctx.createGain();
    gain.gain.value = p.gain;
    gain.connect(out);
    out.connect(this.sfx);
    SYNTHS[p.cue](ctx, gain, this.noise!, ctx.currentTime);
    // Everything a synth makes stops within a second; let the graph go after that.
    setTimeout(() => out.disconnect(), 1500);
  }

  /** A low thump, for the low-health heartbeat. */
  heartbeat(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== "running") return;
    const g = ctx.createGain();
    g.connect(this.sfx);
    const t = ctx.currentTime;
    tone(ctx, g, "sine", 70, 45, t, 0.14, 0.5 * strength);
    tone(ctx, g, "sine", 62, 40, t + 0.16, 0.12, 0.35 * strength);
    setTimeout(() => g.disconnect(), 800);
  }

  /** The cart's motor, pitched by speed (0..1). Started lazily; `engineStop` silences it. */
  engine(speed01: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== "running") return;
    if (!this.engineGain) {
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 500;
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.sfx);
      for (const [type, detune] of [["sawtooth", 0], ["square", 7]] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.detune.value = detune;
        osc.connect(this.engineFilter);
        osc.start();
        this.engineOsc.push(osc);
      }
    }
    const s = Math.min(1, Math.max(0, Math.abs(speed01)));
    const t = ctx.currentTime;
    for (const osc of this.engineOsc) osc.frequency.setTargetAtTime(38 + 70 * s, t, 0.08);
    this.engineFilter!.frequency.setTargetAtTime(280 + 900 * s, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.035 + 0.06 * s, t, 0.1);
  }

  engineStop(): void {
    if (!this.ctx || !this.engineGain) return;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  private applyLevels(): void {
    if (!this.master || !this.sfx || !this.music || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.levels.muted ? 0 : this.levels.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.02);
    this.music.gain.setTargetAtTime(this.levels.music, t, 0.02);
  }
}

/** The page's one audio engine. */
export const gameAudio = new AudioEngine();

type Synth = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number) => void;

const SYNTHS: Record<Cue, Synth> = {
  // Putter: a quick, bright pop.
  pop: (ctx, out, noise, t) => {
    tone(ctx, out, "sine", 950, 260, t, 0.07, 0.5);
    burst(ctx, out, noise, t, 0.025, "highpass", 3000, 0.25);
  },
  // Iron: a woody clack.
  clack: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.05, "bandpass", 1900, 0.55);
    tone(ctx, out, "triangle", 620, 380, t, 0.08, 0.3);
  },
  // Driver: a heavy thwack with a thump under it.
  thwack: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.12, "lowpass", 1400, 0.7);
    tone(ctx, out, "sine", 140, 55, t, 0.18, 0.8);
  },
  // The player's ball connected: a bright ding.
  hit: (ctx, out, _noise, t) => {
    tone(ctx, out, "square", 1320, 1180, t, 0.09, 0.18);
    tone(ctx, out, "sine", 1980, 1980, t, 0.14, 0.2);
  },
  // The player was hit: a dull crunch.
  hurt: (ctx, out, noise, t) => {
    tone(ctx, out, "sawtooth", 210, 85, t, 0.22, 0.35);
    burst(ctx, out, noise, t, 0.12, "lowpass", 900, 0.5);
  },
  // The player made a kill: a rising two-note chime.
  kill: (ctx, out, noise, t) => {
    tone(ctx, out, "sine", 660, 660, t, 0.16, 0.35);
    tone(ctx, out, "sine", 990, 990, t + 0.1, 0.28, 0.35);
    burst(ctx, out, noise, t, 0.3, "lowpass", 600, 0.4);
  },
  // The player died.
  death: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.6, "lowpass", 700, 0.9);
    tone(ctx, out, "sawtooth", 180, 40, t, 0.7, 0.4);
  },
  // Someone else's cart went up.
  blast: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.45, "lowpass", 500, 0.8);
    tone(ctx, out, "sine", 90, 35, t, 0.4, 0.5);
  },
  pickup: (ctx, out, _noise, t) => {
    tone(ctx, out, "sine", 880, 880, t, 0.06, 0.25);
    tone(ctx, out, "sine", 1175, 1175, t + 0.06, 0.06, 0.25);
    tone(ctx, out, "sine", 1568, 1568, t + 0.12, 0.1, 0.25);
  },
  // A drink: the pickup arpeggio a fourth higher.
  shield: (ctx, out, _noise, t) => {
    tone(ctx, out, "sine", 1175, 1175, t, 0.06, 0.25);
    tone(ctx, out, "sine", 1568, 1568, t + 0.06, 0.06, 0.25);
    tone(ctx, out, "sine", 2093, 2093, t + 0.12, 0.12, 0.25);
  },
  // A shield plate broke: the hit ding, shorter and higher, with a glassy tick.
  plate: (ctx, out, noise, t) => {
    tone(ctx, out, "square", 1760, 1480, t, 0.06, 0.16);
    burst(ctx, out, noise, t, 0.04, "highpass", 5000, 0.3);
  },
  // A trigger pull with nothing in the barrel.
  dry: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.018, "highpass", 4500, 0.35);
  },
  splash: (ctx, out, noise, t) => {
    burst(ctx, out, noise, t, 0.5, "bandpass", 1200, 0.6);
  },
};

/** An oscillator gliding from `f0` to `f1` Hz under a fast-attack, exponential-decay envelope. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  f0: number,
  f1: number,
  t: number,
  length: number,
  peak: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + length);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** A filtered slice of white noise under the same envelope. */
function burst(
  ctx: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  length: number,
  filterType: BiquadFilterType,
  frequency: number,
  peak: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
