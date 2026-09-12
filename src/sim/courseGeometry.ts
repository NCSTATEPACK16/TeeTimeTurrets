/**
 * The geometry `courseLayout.ts` and `courseRelaxation.ts` both need. Lives here, strictly
 * upstream of both, so neither has to import the other for it.
 *
 * `tools/importCycles.test.mjs` is the reason this file exists rather than one of those two
 * importing from the other: a value-import cycle between them is exactly the shape of a defect
 * this repo has already shipped once (see that test's own comment for the bunker-NaN incident).
 * `courseRelaxation.ts` needs `chordOf`/`placedControl`/`polylineClearance` and the transition
 * and clearance constants to run its constraint solver; `courseLayout.ts` needs the same
 * functions for its own `inspectLayout` and fallback construction, plus `LayoutHole`/
 * `HolePlacement` as the shared vocabulary between the two. Putting them here means neither
 * module's import graph ever points back at the other.
 */

import type { Vec2 } from "./mapGeometry";

/** The structural slice of a `HoleSpec` a layout needs. Structural so tests need no generator. */
export interface LayoutHole {
  /** 0-based, as `HoleSpec.index` is. */
  readonly index: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /** Corridor centreline control points, tee first and cup last. Used for clearance only. */
  readonly control: readonly Vec2[];
}

/**
 * Anything with a place in the course frame: an offset for its own origin and a rotation about
 * it. A `HolePlacement` is one; a `PlacedField` (courseLayout.ts) is one with a size attached.
 */
export interface CourseFrame {
  readonly offsetX: number;
  readonly offsetZ: number;
  /** Rotation of the local frame within the course frame, radians. */
  readonly rotation: number;
}

/** Where one hole's local frame sits in the course frame. */
export interface HolePlacement extends CourseFrame {
  readonly index: number;
}

/**
 * A point in a hole's local frame, expressed in the course frame.
 *
 * This lives here rather than beside the map that first needed it because the contiguous terrain
 * needs the same transform, and `src/sim/**` cannot import `src/ui/**`. A second copy in the sim
 * is the failure this project has already had once with a duplicated constant: the map and the
 * ground would agree until one of them was edited.
 */
export function toCourseFrame(
  frame: CourseFrame,
  localX: number,
  localZ: number,
  out: { x: number; z: number },
): void {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  // Rotate about the field's own centre, then translate: the offset is where the centre lands,
  // so rotating after translating would swing the hole around the course origin instead.
  out.x = frame.offsetX + localX * cos - localZ * sin;
  out.z = frame.offsetZ + localX * sin + localZ * cos;
}

/** Metres from a green to the next tee. The walk, and what keeps the loop from being a polygon
 *  with its corners at the cups. */
export const TRANSITION_M = 30;

/** Floor and ceiling on a green-to-tee walk once relaxation is allowed to stretch or compress
 *  it. RESEARCH-ROUTING.md §Q3: a fixed 30 m walk left the loop with no slack to absorb the
 *  residual displacement a lobed shape leaves behind. Outside this range a transition is a
 *  defect, not a variation. */
export const TRANSITION_MIN_M = 15;
export const TRANSITION_MAX_M = 100;

/** Corridors closer than this are reported as a conflict by `inspectLayout`. */
export const CORRIDOR_CLEARANCE_M = 35;

/**
 * Corridors are allowed to converge within this distance of the clubhouse, and nowhere else.
 *
 * Returning nines means holes 1, 9, 10 and 18 all finish or start on the same apron -- that is
 * what the shape *is*, and a rule that called it a conflict would be a rule against the design.
 * Wide enough to cover the 90 m between the two tees plus a corridor either side of each.
 */
export const CLUBHOUSE_APRON_M = 140;

export function chordOf(hole: LayoutHole): number {
  return Math.hypot(hole.cup.x - hole.tee.x, hole.cup.z - hole.tee.z);
}

/** A hole's corridor centreline, in course-frame metres. */
export function placedControl(hole: LayoutHole, placement: HolePlacement): Vec2[] {
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  return hole.control.map((p) => ({
    x: placement.offsetX + p.x * cos - p.z * sin,
    z: placement.offsetZ + p.x * sin + p.z * cos,
  }));
}

/** Distance from point p to the segment ab. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/**
 * Closest approach between two centreline polylines, and roughly where it happens. Sampled at the
 * vertices of each against the segments of the other, which is exact for polylines that do not
 * cross. The location is wanted because a convergence at the clubhouse is the design and a
 * convergence anywhere else is a defect.
 */
export function polylineClearance(a: readonly Vec2[], b: readonly Vec2[]): { distance: number; at: Vec2 } {
  let best = Infinity;
  let at: Vec2 = a[0] ?? { x: 0, z: 0 };
  for (const p of a) {
    for (let i = 0; i + 1 < b.length; i++) {
      const d = pointToSegment(p, b[i]!, b[i + 1]!);
      if (d < best) {
        best = d;
        at = p;
      }
    }
  }
  for (const p of b) {
    for (let i = 0; i + 1 < a.length; i++) {
      const d = pointToSegment(p, a[i]!, a[i + 1]!);
      if (d < best) {
        best = d;
        at = p;
      }
    }
  }
  return { distance: best, at };
}
