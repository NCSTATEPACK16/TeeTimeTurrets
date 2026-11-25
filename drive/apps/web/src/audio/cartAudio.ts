import type { WheelDynamics } from '../vehicle/wheelDynamics';
import { skidTintFor } from '../fx/skidEmitter';
import { audioConfig as cfg } from './audioConfig';

export interface AudioFrame {
  speed: number;
  throttle: number;
  wheels: readonly WheelDynamics[];
}

/**
 * WebAudio synthesis for the cart. Browsers only start audio after a user gesture, so the
 * graph is built on the first key press or click. Browser-only: never import from Node tests.
 */
export class CartAudio {
  private ctx: AudioContext | null = null;
  private motor!: OscillatorNode;
  private motorGain!: GainNode;
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

    // Motor: sawtooth through a lowpass.
    this.motor = new OscillatorNode(ctx, { type: 'sawtooth', frequency: cfg.motor.idleHz });
    const motorFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cfg.motor.cutoffHz });
    this.motorGain = new GainNode(ctx, { gain: 0 });
    this.motor.connect(motorFilter).connect(this.motorGain).connect(this.master);
    this.motor.start();

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
    const m = cfg.motor;
    this.motor.frequency.setTargetAtTime(m.idleHz + m.hzPerMps * speed + m.throttleHz * f.throttle, now, m.glide);
    this.motorGain.gain.setTargetAtTime(m.gainIdle + m.gainThrottle * f.throttle, now, m.glide);

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
