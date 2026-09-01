/**
 * Seeded randomness for the deterministic simulation.
 *
 * `Math.random()` is banned in src/sim/** and src/physics/** (AGENTS.md): it carries hidden
 * engine state and gives no cross-platform guarantee, so a client and an authoritative server
 * would silently disagree. Mulberry32's entire state is one 32-bit word, which makes "the same
 * hole twice" and "the same hole on two machines" the same statement.
 *
 * `hashChannel` is the other half of that. A single advancing stream couples every consumer to
 * call order -- ask for a sand sample before a height sample and both change. Hashing the seed
 * together with a channel index instead gives each consumer an independent stream evaluable in
 * any order, which is what lets terrain.ts and surfaces.ts both derive from one HoleSpec.seed
 * without correlating (see the spec's channel table, §3 "Seeding").
 */

/** Uniform in [0, 1). The seed is coerced to uint32, so a negative seed is legal. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes a seed with any number of integer coordinates into a fresh uint32 seed.
 *
 * Order matters: hashChannel(s, 1, 0) and hashChannel(s, 0, 1) are different channels. The
 * trailing avalanche runs even for an empty coordinate list, so hashChannel(s) is not just s --
 * without it a zero-coordinate call would leak the raw seed into a consumer.
 *
 * The rest parameter allocates. This is a construction-time call and never a per-tick one.
 */
export function hashChannel(seed: number, ...coords: readonly number[]): number {
  let state = seed >>> 0;
  for (const coord of coords) {
    state = (state + Math.imul(coord | 0, 0x85ebca6b)) >>> 0;
    state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
    state = (state ^ (state + Math.imul(state ^ (state >>> 7), state | 61))) >>> 0;
    state = (state ^ (state >>> 14)) >>> 0;
  }
  state = Math.imul(state ^ (state >>> 16), 0x2545f491) >>> 0;
  return (state ^ (state >>> 15)) >>> 0;
}
