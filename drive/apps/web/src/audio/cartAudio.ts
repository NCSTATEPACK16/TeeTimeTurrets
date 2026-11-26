import type { WheelDynamics } from '../vehicle/wheelDynamics';
import { skidTintFor } from '../fx/skidEmitter';
import { audioConfig as cfg } from './audioConfig';

export interface AudioFrame {
  speed: number;
  /** The mode's governed top speed, m/s: the engine pitches by speed as a share of it. */
  topSpeed: number;
  wheels: readonly WheelDynamics[];
}

/**
 * WebAudio synthesis for the cart. Browsers only start audio after a user gesture, so the
 * graph is built on the first key press or click. Browser-only: never import from Node tests.
 */
export class CartAudio {
  private ctx: AudioContext | null = null;
  private readonly engineOsc: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private tireFilter!: BiquadFilterNode;
  private tireGain!: GainNode;
  private squealGain!: GainNode;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly start = () => this.init();

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.start);
    target.addEventListener('pointerdown', this.start);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private init(): void {
    this.target.removeEventListener('keydown', this.start);
    this.target.removeEventListener('pointerdown', this.start);
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = new GainNode(ctx, { gain: cfg.masterGain });
    this.master.connect(ctx.destination);

    // Engine: Turrets' sawtooth and detuned square through a lowpass.
    const e = cfg.engine;
    this.engineFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: e.cutoffHz });
    this.engineGain = new GainNode(ctx, { gain: 0 });
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const [type, detune] of [
      ['sawtooth', 0],
      ['square', e.detuneCents],
    ] as const) {
      const osc = new OscillatorNode(ctx, { type, frequency: e.baseHz, detune });
      osc.connect(this.engineFilter);
      osc.start();
      this.engineOsc.push(osc);
    }

    // Tires: looped noise through a band-pass whose center and gain follow the surface.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const tireSource = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    this.tireFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 800, Q: cfg.tires.q });
    this.tireGain = new GainNode(ctx, { gain: 0 });
    tireSource.connect(this.tireFilter).connect(this.tireGain).connect(this.master);
    tireSource.start();

    // Squeal: a wobbling triangle, gated by the skid emitter.
    const squeal = new OscillatorNode(ctx, { type: 'triangle', frequency: cfg.squeal.hz });
    const vibrato = new OscillatorNode(ctx, { frequency: cfg.squeal.vibratoHz });
    const vibratoDepth = new GainNode(ctx, { gain: cfg.squeal.vibratoDepth });
    vibrato.connect(vibratoDepth).connect(squeal.frequency);
    this.squealGain = new GainNode(ctx, { gain: 0 });
    squeal.connect(this.squealGain).connect(this.master);
    squeal.start();
    vibrato.start();
  }

  update(f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const speed = Math.abs(f.speed);
    const e = cfg.engine;
    const s01 = Math.min(1, speed / Math.max(f.topSpeed, 1e-3));
    for (const osc of this.engineOsc) osc.frequency.setTargetAtTime(e.baseHz + e.spanHz * s01, now, e.pitchGlide);
    this.engineFilter.frequency.setTargetAtTime(e.cutoffHz + e.cutoffSpanHz * s01, now, e.glide);
    this.engineGain.gain.setTargetAtTime((e.gain + e.gainSpan * s01) * e.level, now, e.glide);

    // Tire noise from the wheels on the ground: loudest surface wins the filter.
    let gain = 0;
    let loudest = 0;
    let hz = 800;
    let skidding = false;
    for (const w of f.wheels) {
      if (!w.inContact && w.waterDepth <= 0) continue;
      const s = cfg.tires.surfaces[w.waterDepth > 0.05 ? 'water' : w.material];
      const g = (s.gain * Math.min(w.speed / cfg.tires.fullAt, 1)) / 4;
      if (g > loudest) {
        loudest = g;
        hz = s.hz;
      }
      gain += g;
      if (w.material === 'cartpath' && skidTintFor(w)) skidding = true;
    }
    this.tireFilter.frequency.setTargetAtTime(hz, now, 0.05);
    this.tireGain.gain.setTargetAtTime(gain, now, 0.05);
    this.squealGain.gain.setTargetAtTime(skidding ? cfg.squeal.gain : 0, now, 0.04);
  }

  /** Turrets' goofy two-tone golf-cart honk. */
  honk(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = new GainNode(ctx, { gain: cfg.honk.gain * cfg.engine.level });
    out.connect(this.master);
    const t = ctx.currentTime;
    let end = t;
    for (const [f0, f1, at, length, peak] of cfg.honk.tones) {
      // Turrets' tone(): a fast attack and an exponential decay over a gliding square.
      const osc = new OscillatorNode(ctx, { type: 'square' });
      osc.frequency.setValueAtTime(f0, t + at);
      osc.frequency.exponentialRampToValueAtTime(f1, t + at + length);
      const env = new GainNode(ctx, { gain: 0.0001 });
      env.gain.setValueAtTime(0.0001, t + at);
      env.gain.exponentialRampToValueAtTime(peak, t + at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, t + at + length);
      osc.connect(env).connect(out);
      osc.start(t + at);
      osc.stop(t + at + length + 0.02);
      end = Math.max(end, t + at + length + 0.02);
    }
    setTimeout(() => out.disconnect(), (end - t) * 1000 + 100);
  }

  /** Noise burst for hitting water; speed in m/s. */
  splash(speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = cfg.splash;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noise });
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: s.cutoffHz });
    const gain = new GainNode(ctx, { gain: Math.min(speed * s.gainPerMps, s.maxGain) });
    gain.gain.setTargetAtTime(0, ctx.currentTime + 0.05, s.seconds / 4);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + s.seconds);
  }

  /** Low thump for a landing; touchdown speed in m/s. */
  thump(speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = cfg.thump;
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: t.hz });
    const gain = new GainNode(ctx, { gain: Math.min(speed * t.gainPerMps, t.maxGain) });
    gain.gain.setTargetAtTime(0, ctx.currentTime, t.seconds / 4);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + t.seconds);
  }
}
