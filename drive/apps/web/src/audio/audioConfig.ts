import type { MaterialName } from '@gcs/level-schema';

/** Synthesized cart audio (no asset files): motor whine, tire noise per surface, squeal, splash. */
export const audioConfig = {
  masterGain: 0.5,
  motor: {
    /** Sawtooth pitch at rest and per m/s, Hz. */
    idleHz: 55,
    hzPerMps: 14,
    /** Extra pitch with the pedal down, Hz. */
    throttleHz: 25,
    /** Lowpass cutoff over the oscillator, Hz. */
    cutoffHz: 900,
    gainIdle: 0.04,
    gainThrottle: 0.12,
    /** Pitch and gain glide time constant, s. */
    glide: 0.08,
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
