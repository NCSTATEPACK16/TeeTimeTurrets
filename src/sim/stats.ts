/**
 * Minimal round-scoped counters, deliberately not a round model. Phase 1.75's `round.ts` absorbs
 * this once that phase resumes (see docs/superpowers/specs/2026-09-02-targets-health-combat-design.md
 * §6); until then it exists so the numbers image 13's scorecard will want are real from the start
 * rather than hardcoded zeros.
 *
 * Not reset by `Sim.reset()`: a round is a sequence of holes, and hits/accuracy read as round
 * totals. Strokes, which are per-hole, stay on `Sim` where they already live.
 */

export interface Stats {
  /** Cart-mode shots that actually spawned a ball -- a 0-ammo blank is not a shot fired. */
  shotsFired: number;
  /** Ball-vs-target and ball-vs-cart contacts resolved by combat.ts. */
  directHits: number;
  /** Distinct targets whose `isDown` flipped true. */
  targetsDown: number;
}

export function createStats(): Stats {
  return { shotsFired: 0, directHits: 0, targetsDown: 0 };
}

/** 0 rather than NaN before the first shot -- a HUD would render "NaN%". */
export function accuracy(s: Stats): number {
  return s.shotsFired === 0 ? 0 : s.directHits / s.shotsFired;
}
