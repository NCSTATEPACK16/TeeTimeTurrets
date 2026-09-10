/**
 * Where the map is looking, and how a world position becomes a pixel on it.
 *
 * DOM-free so the framing rules are asserted in the node suite rather than eyeballed against a
 * canvas -- the same split `hudState.ts` makes from `hud.ts`, and `plateState.ts` from
 * `nameplates.ts`.
 *
 * A hole sits in the course frame at an offset and a rotation. Today the course holds one hole at
 * the origin with no rotation, because `Sim` loads one hole at a time; the frame exists now so the
 * map does not have to be rebuilt when `src/sim/courseLayout.ts` places all eighteen.
 */

/**
 * The frame itself moved to `src/sim/courseLayout.ts` once the contiguous terrain needed it:
 * the sim cannot import from `src/ui/**`, and two copies of a rotation would drift. Re-exported
 * here so the map keeps reading the frame from the module it has always read it from.
 */
import type { Bounds } from "../sim/courseLayout";

export { boundsOf, toCourseFrame, toHoleFrame } from "../sim/courseLayout";
export type { Bounds, CourseFrame, PlacedField } from "../sim/courseLayout";

/** World metres -> canvas pixels, preserving aspect so the course is never stretched. */
export interface MapProjection {
  readonly scale: number;
  x(courseX: number): number;
  y(courseZ: number): number;
}

/** Grows a box by `metres` on every side, so markers at the very edge are not clipped. */
export function padBounds(bounds: Bounds, metres: number): Bounds {
  return {
    minX: bounds.minX - metres,
    minZ: bounds.minZ - metres,
    maxX: bounds.maxX + metres,
    maxZ: bounds.maxZ + metres,
  };
}

/**
 * Fits `bounds` inside a `width` x `height` canvas, centred, at one scale for both axes.
 *
 * One scale rather than two is the whole point: a course stretched to fill a wide viewport would
 * misreport every angle on it, and the angle between a tee and a green is the thing a player is
 * reading the map for.
 */
export function fitProjection(
  bounds: Bounds,
  width: number,
  height: number,
  paddingPx: number,
): MapProjection {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const usableW = Math.max(0, width - paddingPx * 2);
  const usableH = Math.max(0, height - paddingPx * 2);

  // A zero-extent box would divide by zero. Scale 1 keeps the projection finite and puts the
  // single point in the middle of the canvas, which is the only sensible picture of it.
  const scale = spanX > 0 && spanZ > 0 ? Math.min(usableW / spanX, usableH / spanZ) : 1;

  // Whatever the fitted axis does not use is split evenly, so the course sits centred rather
  // than pinned to a corner.
  const originX = paddingPx + (usableW - spanX * scale) / 2;
  const originZ = paddingPx + (usableH - spanZ * scale) / 2;

  return {
    scale,
    x: (courseX: number) => originX + (courseX - bounds.minX) * scale,
    // World +Z runs *down* the page, the same handedness the heightfield uses (row -> Z) and the
    // committed plans draw. Flipping it here would mirror every dog-leg.
    y: (courseZ: number) => originZ + (courseZ - bounds.minZ) * scale,
  };
}
