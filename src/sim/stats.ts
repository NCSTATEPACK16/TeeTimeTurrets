/**
 * The player's shot counters for a match, and the accuracy they add up to.
 *
 * Not reset by `Sim.reset()`: a rematch is a retry, and the shots fired before it were still fired.
 */

export interface Stats {
  /** Shots that actually spawned a ball -- a 0-ammo blank is not a shot fired. */
  shotsFired: number;
  /** Ball-vs-cart contacts from the player's own balls, resolved by combat.ts. */
  directHits: number;
}

export function createStats(): Stats {
  return { shotsFired: 0, directHits: 0 };
}

/** 0 rather than NaN before the first shot -- a HUD would render "NaN%". */
export function accuracy(s: Stats): number {
  return s.shotsFired === 0 ? 0 : s.directHits / s.shotsFired;
}
