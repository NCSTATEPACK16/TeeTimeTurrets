/**
 * The two measured driver distances the course generator reasons about.
 *
 * A leaf module with no imports, and that is the point rather than an accident. These constants
 * were written in `course.ts`, which imports `placement.ts`, which needs them back -- a value
 * import cycle. `placement.ts` only reads them inside function bodies today, so the cycle was
 * harmless, but the identical shape one edge over is what left the built game rendering nothing
 * but sky: a module-level constant in `placement.ts` derived from a `surfaces.ts` export read
 * `undefined` because Rollup emitted the initialiser after the reader. See `WOODS_WEIGHT` in
 * `terrain.ts` for the full account. Homing shared constants in a leaf is what makes that class
 * of bug unreachable rather than merely absent, and `src/sim/imports.test.ts` holds the line.
 */

/**
 * The driver's full-power distance, in metres, as measured by `npm run probe` in Phase 0:
 * 129 m TOTAL -- 69.5 m carry plus 59.5 m roll-out. Total rather than carry is the right
 * quantity for both consumers: a hole is reachable on where the ball ends up, and par follows
 * the same logic.
 *
 * This is NOT a second copy of CLUB_STATS. AGENTS.md forbids a second source of truth for club
 * stats, and distance is not a field in that table -- it is an emergent result of the
 * ballistics integration. The link is closed by a probe assertion that measured driver distance
 * stays within +-15% of this number, so a club-balance change that invalidates par fails the
 * probe instead of silently mis-parring every hole.
 */
export const REFERENCE_CARRY_M = 129;

/**
 * The driver's *carry*, as distinct from `REFERENCE_CARRY_M`'s total. Same Phase 0 measurement:
 * 129 m total = 69.5 m carry + 59.5 m roll-out.
 *
 * Carry is the right quantity for exactly one question -- can a player fly a water hazard -- and
 * that is what check 6 asks. Total is right for par, because a hole is reachable on where the
 * ball ends up. It was written in `tools/holePlan.ts` first and moved to `course.ts` when a
 * second consumer appeared; it is here now for the third, and a second copy of a measured
 * constant is the failure AGENTS.md names.
 */
export const DRIVER_CARRY_M = 69.5;
