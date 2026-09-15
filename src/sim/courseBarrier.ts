/**
 * Where the cart is allowed to be: inside the ground's own box, and on the playing side of the
 * course's southern boundary.
 *
 * **Two different facts, and the box cannot express the second one.** The bounds are axis-aligned
 * because a heightfield is; past their edge there are no heights and there is nothing to stand on,
 * so a clamp there is a statement about the terrain. County Home Road is a *diagonal* -- it runs
 * east and south across the bottom of the plat -- so the box's flat `minZ` sits well south of it at
 * the western end, and the wedge between the two is ground that is inside the bounds, on the
 * heightfield, and on the wrong side of a public road. `moveCartBody` has clamped to the box since
 * the arena landed; this module is what adds the road.
 *
 * **A clamp rather than a Rapier collider, deliberately.** A wall on a course this size is four
 * long thin boxes that have to be rebuilt whenever the bounds move, and the bounds are already the
 * authority. Clamping the *result* of the controller's movement, rather than teleporting, is what
 * makes a cart driven into the edge slide along it instead of stopping dead. Rejected: a static
 * collider ring, for the rebuild cost; and a teleport-back, which reads as a glitch.
 *
 * DOM-free and Rapier-free, like the rest of `src/sim/**`: it is arithmetic on a point.
 */

import type { Vec2 } from "./mapGeometry";
import type { Bounds } from "./courseLayout";

/**
 * A straight boundary the course may not be played across, as two points on it.
 *
 * "North" is the side the normal `(-dz, dx)` points to, which for a line running east-and-south is
 * the playing side. Storing two points rather than a normal keeps it the same shape as the thing it
 * was traced from and leaves one place -- `metresNorthOf` -- deciding which side is which.
 */
export interface SouthBoundary {
  readonly a: Vec2;
  readonly b: Vec2;
}

/**
 * How far short of the road the cart is held, in metres.
 *
 * Wider than the cart's own radius on purpose: stopping with the collider's edge exactly on the
 * kerb reads as clipping into it. This is a verge.
 */
export const BARRIER_INSET_M = 6;

/**
 * Signed distance north of the boundary; negative is the road side.
 *
 * The one definition of which side is which. `authoredLayout.ts` re-exports it against the course's
 * own traced line rather than repeating the arithmetic, because a test asserting the course is
 * north of the road and a clamp keeping the cart there must not be able to disagree.
 */
export function metresNorthOf(line: SouthBoundary, x: number, z: number): number {
  const dx = line.b.x - line.a.x;
  const dz = line.b.z - line.a.z;
  return ((x - line.a.x) * -dz + (z - line.a.z) * dx) / Math.hypot(dx, dz);
}

/**
 * Holds a point inside `bounds`, inset by `inset`. Returns whether it had to move it.
 *
 * Extracted from `moveCartBody`, where it was four inline `Math.min`/`Math.max` calls, so that the
 * road clamp beside it is not a second unrelated-looking piece of arithmetic in the hot loop.
 */
export function clampToBounds(
  bounds: Bounds,
  inset: number,
  x: number,
  z: number,
  out: { x: number; z: number },
): boolean {
  out.x = Math.min(bounds.maxX - inset, Math.max(bounds.minX + inset, x));
  out.z = Math.min(bounds.maxZ - inset, Math.max(bounds.minZ + inset, z));
  return out.x !== x || out.z !== z;
}

/**
 * Holds a point at least `inset` metres north of `line`. Returns whether it had to move it.
 *
 * Pushed along the line's own normal rather than straight up in `z`: the line is diagonal, so a
 * correction in `z` alone would both overshoot and slide the cart east, and a cart driving into the
 * road at an angle would crab along it instead of sliding.
 */
export function clampNorthOf(
  line: SouthBoundary,
  inset: number,
  x: number,
  z: number,
  out: { x: number; z: number },
): boolean {
  const north = metresNorthOf(line, x, z);
  if (north >= inset) {
    out.x = x;
    out.z = z;
    return false;
  }
  const dx = line.b.x - line.a.x;
  const dz = line.b.z - line.a.z;
  const length = Math.hypot(dx, dz);
  const push = inset - north;
  out.x = x + (-dz / length) * push;
  out.z = z + (dx / length) * push;
  return true;
}

/**
 * Both rules. The result is inside the box *and* north of the road.
 *
 * **The order is not load-bearing on this course, and saying so is the honest version.** Box first
 * then road guarantees the road; road first then box guarantees the box; they differ only where the
 * road's inset locus falls outside the bounds, and on this course it does not -- measured along the
 * whole of County Home Road, and asserted in `courseBarrier.test.ts` so that a later course which
 * *does* make them conflict fails instead of quietly picking one. The road is applied last so that
 * if that day comes, the fictional boundary is the one that survives.
 *
 * The box is the constraint that matters almost everywhere: the bounds' flat southern edge lies
 * south of the diagonal road across 84% of the course's width, by as much as 332 m.
 */
export function clampToPlayable(
  bounds: Bounds,
  line: SouthBoundary | null,
  boundsInset: number,
  x: number,
  z: number,
  out: { x: number; z: number },
): boolean {
  const movedByBox = clampToBounds(bounds, boundsInset, x, z, out);
  if (line === null) return movedByBox;
  const movedByRoad = clampNorthOf(line, BARRIER_INSET_M, out.x, out.z, out);
  return movedByBox || movedByRoad;
}
