import type { MaterialName } from '@gcs/level-schema';

/**
 * Per-surface tuning from the PRD surface model. The PRD table is qualitative, so the
 * numbers are picked here: grip scales the cart's frictionSlip, rollingDrag scales its
 * rolling resistance. Cart path is the 1.0 / 1.0 reference.
 */
export interface SurfaceTuning {
  /** Multiplier on the cart's frictionSlip. */
  grip: number;
  /** Multiplier on rolling resistance. */
  rollingDrag: number;
}

export const surfaces: Record<MaterialName, SurfaceTuning> = {
  // PRD "High / Low": concrete, the reference.
  cartpath: { grip: 1.0, rollingDrag: 1.0 },
  // PRD "Medium / Low": short turf gives way under a hard turn.
  fairway: { grip: 0.85, rollingDrag: 1.2 },
  fringe: { grip: 0.85, rollingDrag: 1.2 },
  tee: { grip: 0.85, rollingDrag: 1.2 },
  // PRD "Medium / Low": the shortest, smoothest turf rolls a little easier than fairway.
  green: { grip: 0.85, rollingDrag: 1.1 },
  // PRD "Medium-low / Medium": long grass and pine straw.
  rough: { grip: 0.7, rollingDrag: 1.8 },
  woods: { grip: 0.7, rollingDrag: 1.8 },
  // Not in the PRD table: packed bank soil, between rough and fairway.
  embankment: { grip: 0.7, rollingDrag: 1.6 },
  // PRD "Low / High": soft sand bogs the cart down and lets the rear slide.
  bunker: { grip: 0.45, rollingDrag: 4.0 },
  // Wet pond bed. Most of the slowing comes from the water model's depth drag (cartTuning.water).
  water: { grip: 0.6, rollingDrag: 2.0 },
};
