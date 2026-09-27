/**
 * Rapier collision groups: the high 16 bits are what a collider is, the low 16 what it will touch.
 * Two colliders interact only when each one's membership is in the other's filter.
 *
 * Only the hull needs this. It is a ball-only hitbox, and without a filter the character
 * controller would drive every cart into its neighbours' hulls -- and into its own.
 * A leaf module, so `BallPool` and `world.ts` can share it without a cycle.
 */

const CART_BIT = 0x0001;
const BALL_BIT = 0x0002;
const HULL_BIT = 0x0004;
const ALL = 0xffff;

function groups(membership: number, filter: number): number {
  return ((membership << 16) | filter) >>> 0;
}

/** A cart's movement capsule: touches everything except hulls. Also the KCC's query filter. */
export const CART_GROUPS = groups(CART_BIT, ALL & ~HULL_BIT);
/** A fired ball: touches everything. */
export const BALL_GROUPS = groups(BALL_BIT, ALL);
/** A cart's hull hitbox: touches balls and nothing else. */
export const HULL_GROUPS = groups(HULL_BIT, BALL_BIT);
