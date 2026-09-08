/**
 * Counters for **one hole**, and the fold that turns a sequence of them into a round.
 *
 * These were round-scoped when `Sim` was the only thing that existed and a session was one hole
 * long. They are per-hole now, and the change is what makes a per-hole purse possible: a round
 * total cannot be priced hole by hole, because paying out a running total on every hole pays for
 * hole 1 again on hole 2. `Round` holds the fold; `Sim` holds the hole. See `session.test.ts`.
 *
 * Still not reset by `Sim.reset()` -- a reset is a retry within the hole being played, and the
 * shots fired before it were still fired. Strokes stay on `Sim`, where they already live.
 */

export interface Stats {
  /** Cart-mode shots that actually spawned a ball -- a 0-ammo blank is not a shot fired. */
  shotsFired: number;
  /** Ball-vs-target and ball-vs-cart contacts resolved by combat.ts. */
  directHits: number;
  /** Distinct targets whose `isDown` flipped true. */
  targetsDown: number;
  /**
   * Longest single ball flight, metres. The fourth tile on image 13's scorecard, and the one the
   * old three-counter shape was missing. A **best, not a total** -- which is why the fold below
   * cannot be a blanket sum.
   */
  longestDriveM: number;
}

export function createStats(): Stats {
  return { shotsFired: 0, directHits: 0, targetsDown: 0, longestDriveM: 0 };
}

/**
 * Folds a finished hole's counters into a running total, in place.
 *
 * Three of the four sum and the fourth does not: a round's longest drive is the longest single
 * drive in it, not the sum of each hole's best. Adding a field here without deciding which kind
 * it is, is the way this quietly starts lying -- an accuracy that reads 340% is obvious, a
 * longest drive of 380 m is not.
 */
export function foldStats(total: Stats, hole: Readonly<Stats>): void {
  total.shotsFired += hole.shotsFired;
  total.directHits += hole.directHits;
  total.targetsDown += hole.targetsDown;
  total.longestDriveM = Math.max(total.longestDriveM, hole.longestDriveM);
}

/** 0 rather than NaN before the first shot -- a HUD would render "NaN%". */
export function accuracy(s: Stats): number {
  return s.shotsFired === 0 ? 0 : s.directHits / s.shotsFired;
}
