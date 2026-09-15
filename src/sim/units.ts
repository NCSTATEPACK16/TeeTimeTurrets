/**
 * Yards at the boundary, metres in the middle.
 *
 * A US golf course is measured in yards and this one is traced from a real card, so the authored
 * hole data is in yards and every number a player reads is in yards. Everything between those two
 * boundaries is metres, because the physics engine, the Blender assets, `CART_TUNING.topSpeed`,
 * `COURSE_CELL_M`, every gate baseline and every probe control already are — and converting them
 * would be a whole-repo rewrite whose only visible effect is one multiply at the HUD.
 *
 * So: convert once when an authored hole is built, convert back once when a distance is shown.
 * Nothing in between knows this file exists.
 *
 * `props.ts`'s `MARKER_DISTANCES_M = [137, 91, 46]` was always the 150, 100 and 50 yard posts with
 * the conversion already applied and the fact never written down. It goes through here now.
 */

/** The international yard, exact by definition since 1959. */
export const YARD_M = 0.9144;

export function toMetres(yards: number): number {
  return yards * YARD_M;
}

export function toYards(metres: number): number {
  return metres / YARD_M;
}
