/**
 * Hazard shapes and the point queries over them.
 *
 * These are the primitives Tier 2 replaces noise thresholds with (docs/COURSE_PIPELINE.md §5).
 * Bunkers become ellipses and water becomes polygons, because both are *placed* things: a bunker
 * guards a specific line and a creek crosses at a specific point, and neither idea survives being
 * expressed as "wherever this noise field happens to exceed 0.72".
 *
 * Pure geometry, DOM-free, no allocation in any query -- `heightAt` and `surfaceAt` call these
 * inside the fixed tick, and `buildHeightfield` calls them ~90,000 times per hole.
 */

import type { Vec2 } from "./course";

/** An ellipse in world XZ, rotated about +Y. Bunkers and greens are both this shape. */
export interface Ellipse {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  /** Radians. Rotates the local +X axis toward +Z. */
  readonly rotation: number;
}

/**
 * A simple polygon in world XZ, implicitly closed. May be concave -- a lateral hazard wrapping a
 * dog-leg elbow is, and that is the case a convex-only test gets wrong.
 */
export interface Polygon {
  readonly points: readonly Vec2[];
}

/**
 * Squared distance in the ellipse's own normalised frame: <1 inside, 1 on the rim, >1 outside.
 *
 * Shared by every other query here so the containment test and the falloff can never disagree
 * about where the rim is.
 */
function normalisedRadiusSq(x: number, z: number, e: Ellipse): number {
  const dx = x - e.x;
  const dz = z - e.z;
  const cos = Math.cos(-e.rotation);
  const sin = Math.sin(-e.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return (localX / e.radiusX) ** 2 + (localZ / e.radiusZ) ** 2;
}

export function pointInEllipse(x: number, z: number, e: Ellipse): boolean {
  return normalisedRadiusSq(x, z, e) < 1;
}

/**
 * 1 at the centre, 0 at the rim and everywhere outside. Linear in normalised radius rather than
 * in its square, so a bunker floor does not come to a point at the centre.
 */
export function ellipseFalloff(x: number, z: number, e: Ellipse): number {
  const r = Math.sqrt(normalisedRadiusSq(x, z, e));
  return r >= 1 ? 0 : 1 - r;
}

/**
 * Approximate signed distance to the ellipse's rim: negative inside, 0 on it, positive outside.
 *
 * `(r - 1) * min(radiusX, radiusZ)`, where r is the normalised radius. The exact distance to an
 * ellipse has no closed form -- it needs a quartic root or an iterative solve -- and this is the
 * standard cheap stand-in. It is **exact for a circle**, which is the case that has to stay
 * byte-identical (every green was a circle before Tier 2), and it under-estimates by at most the
 * axis ratio elsewhere. That is well inside what a smoothstep across a 6 m blend band can notice,
 * and the alternative would put a quartic solve in `heightAt`.
 */
export function ellipseEdgeDistance(x: number, z: number, e: Ellipse): number {
  const r = Math.sqrt(normalisedRadiusSq(x, z, e));
  return (r - 1) * Math.min(e.radiusX, e.radiusZ);
}

/** Distance from a point to a segment, squared. */
function distanceSqToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  let t = lengthSq > 0 ? ((px - ax) * abx + (pz - az) * abz) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}

/**
 * Crossing-number test, with the half-open rule `(az > pz) !== (bz > pz)`.
 *
 * The half-open comparison is what stops a ray that passes exactly through a vertex from counting
 * the crossing twice and reporting an interior point as outside. Generated polygons have
 * axis-aligned vertices often enough that this is a real case, not a theoretical one.
 *
 * Behaviour for a point exactly on the boundary is unspecified, deliberately: no caller needs it,
 * and defining it would cost a tolerance parameter that would then need tuning.
 */
export function pointInPolygon(x: number, z: number, poly: Polygon): boolean {
  const pts = poly.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Unsigned distance to the polygon's boundary. Zero on an edge or a vertex. */
export function polygonDistance(x: number, z: number, poly: Polygon): number {
  const pts = poly.points;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i]!;
    const b = pts[j]!;
    const d = distanceSqToSegment(x, z, a.x, a.z, b.x, b.z);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Negative inside, positive outside, magnitude is the distance to the boundary.
 *
 * This is the one the terrain wants: a single number that says both "is this underwater" and
 * "how far from the bank", so a basin can be carved with a smooth shore rather than a cliff.
 */
export function polygonSignedDistance(x: number, z: number, poly: Polygon): number {
  const d = polygonDistance(x, z, poly);
  return pointInPolygon(x, z, poly) ? -d : d;
}

/**
 * Whether a point is water. **The single definition** -- `surfaces.surfaceAt`, `validateHole` and
 * `crossing.deriveCrossings` all call this rather than each testing the polygons themselves.
 *
 * The green clause is what makes that sharing necessary rather than merely tidy. Hole 13's island
 * green is a green sitting *inside* a water polygon: polygons here have no holes, so the moat is
 * drawn solid and the green is punched out of it by classification order. A validator that tested
 * the polygons directly would find the cup inside water and reject the hole -- the archetype would
 * have been unbuildable, and the failure would have looked like a placement bug rather than a
 * disagreement about what "water" means.
 *
 * It lives here, in the leaf, rather than in `course.ts` where it was written. `crossing.ts` needs
 * it and `terrain.ts` needs `crossing.ts`, so leaving it in `course.ts` made the three a value
 * cycle. `course.ts` re-exports the name, so every existing importer is unaffected. The parameter
 * is structural rather than a `HoleSpec` for the same reason: this file stays a leaf.
 */
export function isWaterAt(
  hole: { readonly green: Ellipse; readonly water: readonly Polygon[] },
  x: number,
  z: number,
): boolean {
  if (pointInEllipse(x, z, hole.green)) return false;
  for (const poly of hole.water) {
    if (pointInPolygon(x, z, poly)) return true;
  }
  return false;
}
