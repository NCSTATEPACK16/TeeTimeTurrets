import type { MaterialName } from '@gcs/level-schema';

/** Synthesized cart audio (no asset files): Turrets' engine and honk, tire noise per surface, squeal, splash. */
export const audioConfig = {
  masterGain: 0.5,
  /**
   * The motor: Turrets' engine (src/audio/audioEngine.ts `engine(speed01)`), two detuned
   * oscillators through a lowpass, all pitched by speed as a share of the mode's top speed.
   */
  engine: {
    /** Oscillator pitch at rest, and the rise to full speed, Hz. */
    baseHz: 38,
    spanHz: 70,
    /** The square's detune against the sawtooth, cents. */
    detuneCents: 7,
    /** Lowpass cutoff at rest, and the rise to full speed, Hz. */
    cutoffHz: 280,
    cutoffSpanHz: 900,
    /** Gain at rest, and the rise to full speed. */
    gain: 0.035,
    gainSpan: 0.06,
    /** Glide time constants for pitch, cutoff and gain, s. */
    pitchGlide: 0.08,
    glide: 0.1,
    /**
     * Turrets plays these through master 0.8; free drive's master is masterGain. This scales the
     * engine and the honk so they sound as loud as they do in Turrets.
     */
    level: 1.6,
  },
  /** Turrets' honk cue: two square tones, [startHz, endHz, startS, lengthS, peak]. */
  honk: {
    tones: [
      [415, 400, 0, 0.16, 0.2],
      [523, 505, 0.17, 0.2, 0.2],
    ] as readonly (readonly [number, number, number, number, number])[],
    /** The cue's gain in Turrets (MatchScreen's HONK). */
    gain: 0.9,
  },
  tires: {
    /** Gain at full speed (fullAt m/s) on each surface; band-pass center frequency. */
    fullAt: 12,
    surfaces: {
      cartpath: { gain: 0.1, hz: 1400 },
      fairway: { gain: 0.06, hz: 700 },
      fringe: { gain: 0.06, hz: 700 },
      tee: { gain: 0.06, hz: 700 },
      green: { gain: 0.05, hz: 800 },
      rough: { gain: 0.09, hz: 500 },
      woods: { gain: 0.1, hz: 450 },
      embankment: { gain: 0.09, hz: 500 },
      bunker: { gain: 0.14, hz: 2500 },
      water: { gain: 0.16, hz: 600 },
    } satisfies Record<MaterialName, { gain: number; hz: number }>,
    q: 0.8,
  },
  squeal: { hz: 820, vibratoHz: 11, vibratoDepth: 25, gain: 0.07 },
  splash: { gainPerMps: 0.06, maxGain: 0.5, cutoffHz: 1200, seconds: 0.6 },
  thump: { gainPerMps: 0.08, maxGain: 0.6, hz: 70, seconds: 0.25 },
};
