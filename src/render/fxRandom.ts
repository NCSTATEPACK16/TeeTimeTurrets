import { hashChannel, mulberry32 } from "../sim/rng";

/**
 * Seeded randomness for decoration: particle scatter, ambient barrages, prop tumbles. Never fed
 * to the sim. Seeded rather than `Math.random` so two captures of the same moment match, which is
 * what makes a screenshot comparison mean anything.
 */
export function fxRandom(seed: number, channel: number): () => number {
  return mulberry32(hashChannel(seed, FX_CHANNEL, channel));
}

/** Keeps render streams apart from every sim stream on the same seed. */
const FX_CHANNEL = 0xf00d;
