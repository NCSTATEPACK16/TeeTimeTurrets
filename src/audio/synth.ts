import type { Settings } from "../app/settings";
import { engineTone, heartbeatPeriod } from "./cues";
import type { CueRequest, SoundCue } from "./cues";

/**
 * The game's sound, synthesised with WebAudio: no audio files, in keeping with the rest of the game
 * being procedural. Three buses -- master, effects and music -- each a gain node, set from the
 * player's settings.
 *
 * The context is created on the first user gesture (`unlock`), because browsers refuse to start
 * one before it, and everything before that is a no-op. `cues.ts` decides what plays and where;
 * this only makes the noise. Not unit-tested: Node has no AudioContext. `npm run smoke` reads
 * `stats` to check events actually reach it.
 */

type Voice = (ctx: AudioContext, out: AudioNode, t: number, gain: number, noise: AudioBuffer) => void;

/** Music changes chord this often, seconds. */
const CHORD_SECONDS = 4;
/** A minor, F, C, G: a loop that neither resolves nor nags. Root frequencies, Hz. */
const CHORDS: readonly (readonly number[])[] = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [261.63, 329.63, 392],
  [196, 246.94, 293.66],
];

export class AudioEngine {
  /** What was asked for, whether or not a context existed to play it. For the smoke test. */
  readonly stats: { requested: number; played: number; byCue: Partial<Record<SoundCue, number>> } = {
    requested: 0,
    played: 0,
    byCue: {},
  };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private settings: Settings;
  private engine: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private pad: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
  private heartbeatTimer = 0;
  private chordTimer = 0;
  private chord = 0;
  private inMatch = false;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  /** True once a context exists and is running. */
  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /**
   * Creates the context, or resumes it. Call from inside a user gesture's handler. Safe to call on
   * every gesture; a browser without WebAudio is left silent.
   */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
      this.apply(this.settings);
      if (this.inMatch) this.startMatchVoices();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  apply(settings: Settings): void {
    this.settings = settings;
    if (!this.ctx || !this.master || !this.sfx || !this.music) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(settings.sfx, t, 0.02);
    this.music.gain.setTargetAtTime(settings.music * 0.35, t, 0.02);
  }

  play(request: CueRequest): void {
    this.stats.requested++;
    this.stats.byCue[request.cue] = (this.stats.byCue[request.cue] ?? 0) + 1;
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise || ctx.state !== "running") return;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, request.pan));
    panner.connect(this.sfx);
    VOICES[request.cue](ctx, panner, ctx.currentTime, request.gain, this.noise);
    // Let the panner go once the longest voice is done with it.
    setTimeout(() => panner.disconnect(), 1500);
    this.stats.played++;
  }

  /** The engine hum and the music, for as long as a match is on screen. */
  startMatch(): void {
    this.inMatch = true;
    this.startMatchVoices();
  }

  stopMatch(): void {
    this.inMatch = false;
    const ctx = this.ctx;
    const t = ctx?.currentTime ?? 0;
    if (this.engine) {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.05);
      this.engine.osc.stop(t + 0.3);
      this.engine = null;
    }
    if (this.pad) {
      this.pad.gain.gain.setTargetAtTime(0, t, 0.3);
      for (const osc of this.pad.oscs) osc.stop(t + 1.5);
      this.pad = null;
    }
    this.heartbeatTimer = 0;
  }

  /**
   * Per frame, in a match: the hum follows the player's speed, the heart beats with the vignette,
   * and the pad moves through its chords.
   */
  update(dt: number, speed: number, vignette01: number, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (this.engine) {
      const tone = engineTone(paused ? 0 : speed);
      this.engine.osc.frequency.setTargetAtTime(tone.frequency, t, 0.08);
      this.engine.filter.frequency.setTargetAtTime(tone.frequency * 5, t, 0.08);
      this.engine.gain.gain.setTargetAtTime(paused ? 0 : tone.gain * 0.35, t, 0.08);
    }
    const period = paused ? 0 : heartbeatPeriod(vignette01);
    if (period > 0 && this.sfx && this.noise) {
      this.heartbeatTimer += dt;
      if (this.heartbeatTimer >= period) {
        this.heartbeatTimer = 0;
        heartbeat(ctx, this.sfx, t, 0.8 * Math.min(1, vignette01 + 0.3));
      }
    } else {
      this.heartbeatTimer = 0;
    }
    if (this.pad) {
      this.chordTimer += dt;
      if (this.chordTimer >= CHORD_SECONDS) {
        this.chordTimer = 0;
        this.chord = (this.chord + 1) % CHORDS.length;
        const notes = CHORDS[this.chord]!;
        this.pad.oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(notes[i % notes.length]! / 2, t, 0.6));
      }
    }
  }

  dispose(): void {
    this.stopMatch();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close();
  }

  private startMatchVoices(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.music) return;
    if (!this.engine) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = engineTone(0).frequency;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 300;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfx);
      osc.start();
      this.engine = { osc, filter, gain };
    }
    if (!this.pad) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.2, ctx.currentTime, 1.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.connect(gain).connect(this.music);
      const notes = CHORDS[this.chord]!;
      const oscs = notes.map((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f / 2;
        osc.detune.value = (i - 1) * 6;
        osc.connect(filter);
        osc.start();
        return osc;
      });
      this.pad = { oscs, gain };
    }
  }
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed LCG: noise does not need the sim's streams, and a fixed buffer sounds the same each run.
  let seed = 0x1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  return buffer;
}

/** A pitched tone with a sweep and a fast-attack, exponential-decay envelope. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  type: OscillatorType,
  from: number,
  to: number,
  length: number,
  gain: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** A filtered noise burst. */
function hiss(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  noise: AudioBuffer,
  filterType: BiquadFilterType,
  frequency: number,
  q: number,
  length: number,
  gain: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

function heartbeat(ctx: AudioContext, out: AudioNode, t: number, gain: number): void {
  tone(ctx, out, t, "sine", 70, 45, 0.12, gain);
  tone(ctx, out, t + 0.16, "sine", 60, 40, 0.14, gain * 0.7);
}

const VOICES: Record<SoundCue, Voice> = {
  // A sharp pop: the putter is a pistol.
  putter: (ctx, out, t, g, noise) => {
    tone(ctx, out, t, "sine", 1100, 260, 0.09, 0.55 * g);
    hiss(ctx, out, t, noise, "highpass", 3000, 0.7, 0.03, 0.35 * g);
  },
  // A metallic clack.
  iron: (ctx, out, t, g, noise) => {
    hiss(ctx, out, t, noise, "bandpass", 2600, 4, 0.07, 0.8 * g);
    tone(ctx, out, t, "square", 460, 380, 0.08, 0.18 * g);
  },
  // A heavy thwack with a low thump under it.
  driver: (ctx, out, t, g, noise) => {
    hiss(ctx, out, t, noise, "lowpass", 1400, 0.8, 0.2, 0.9 * g);
    tone(ctx, out, t, "sine", 140, 55, 0.22, 0.7 * g);
  },
  dryfire: (ctx, out, t, g, noise) => {
    hiss(ctx, out, t, noise, "highpass", 5000, 1, 0.02, 0.4 * g);
    tone(ctx, out, t + 0.02, "square", 1800, 1700, 0.015, 0.08 * g);
  },
  // A bright confirm: your shot landed.
  hit: (ctx, out, t, g) => {
    tone(ctx, out, t, "triangle", 1400, 1400, 0.07, 0.35 * g);
    tone(ctx, out, t + 0.05, "triangle", 2100, 2100, 0.09, 0.3 * g);
  },
  hurt: (ctx, out, t, g, noise) => {
    tone(ctx, out, t, "sawtooth", 200, 80, 0.22, 0.35 * g);
    hiss(ctx, out, t, noise, "lowpass", 700, 0.7, 0.18, 0.5 * g);
  },
  kill: (ctx, out, t, g) => {
    tone(ctx, out, t, "square", 660, 660, 0.08, 0.2 * g);
    tone(ctx, out, t + 0.08, "square", 880, 880, 0.08, 0.2 * g);
    tone(ctx, out, t + 0.16, "square", 1320, 1320, 0.16, 0.22 * g);
  },
  died: (ctx, out, t, g, noise) => {
    tone(ctx, out, t, "sawtooth", 320, 50, 0.7, 0.4 * g);
    hiss(ctx, out, t, noise, "lowpass", 900, 0.5, 0.8, 0.7 * g);
  },
  pickup: (ctx, out, t, g) => {
    tone(ctx, out, t, "sine", 880, 880, 0.07, 0.3 * g);
    tone(ctx, out, t + 0.07, "sine", 1320, 1320, 0.1, 0.3 * g);
  },
  splash: (ctx, out, t, g, noise) => {
    hiss(ctx, out, t, noise, "lowpass", 1100, 0.6, 0.45, 0.8 * g);
    hiss(ctx, out, t + 0.05, noise, "highpass", 2500, 0.8, 0.25, 0.25 * g);
  },
  respawn: (ctx, out, t, g) => {
    tone(ctx, out, t, "sine", 300, 900, 0.3, 0.3 * g);
  },
};
