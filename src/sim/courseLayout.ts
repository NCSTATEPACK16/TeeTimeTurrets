/**
 * Where the eighteen holes actually are, relative to each other and to the clubhouse.
 *
 * `src/sim/course.ts` is explicit that "a course is nine holes, not one nine-hole map": every
 * `HoleSpec` owns a square field centred on its own origin, and nothing has ever said where two
 * holes sit relative to one another. This module is the missing frame. It does not build terrain
 * and it does not touch `Sim` -- it answers one question, in data, so the answer can be argued
 * with before anything expensive is built on it.
 *
 * **Fields overlap; corridors must not.** A hole's field is a square around its corridor while the
 * corridor itself is a ribbon about 40 m wide, so fields overlap and blend into shared rough. The
 * constraint that matters, and the one `inspectLayout` measures, is that two holes' corridors
 * never run into each other.
 *
 * **Where the placements come from.** The eighteen holes are traced from a plat map
 * (`authoredCourse.ts`) and placed from authored offsets (`authoredLayout.ts`). This module keeps
 * the frame, the bounds and the inspector; the chord-fit solver and its relaxation that used to
 * discover a layout were deleted in Stage 9 of the revamp, once nothing the game or its tests
 * built came through them.
 */

import type { Vec2 } from "./mapGeometry";
import {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  placedControl,
  polylineClearance,
  toCourseFrame,
  type CourseFrame,
  type HolePlacement,
  type LayoutHole,
} from "./courseGeometry";

// Re-exported: callers reach these through "./courseLayout", which is where they lived before
// courseGeometry.ts was split out.
export {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  placedControl,
  polylineClearance,
  toCourseFrame,
  type CourseFrame,
  type HolePlacement,
  type LayoutHole,
};

/** A hole's square field, placed in the course frame. */
export interface PlacedField extends CourseFrame {
  /** Metres along a side. The field is square and centred on the hole's own origin. */
  readonly fieldSize: number;
}

/** An axis-aligned box in course-frame metres. */
export interface Bounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** The inverse: a course-frame point read in the hole's own local frame. */
export function toHoleFrame(
  frame: CourseFrame,
  courseX: number,
  courseZ: number,
  out: { x: number; z: number },
): void {
  const dx = courseX - frame.offsetX;
  const dz = courseZ - frame.offsetZ;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  out.x = dx * cos + dz * sin;
  out.z = -dx * sin + dz * cos;
}

/**
 * The axis-aligned box a set of placed fields occupies, including the sweep of any rotation.
 *
 * A square of side s turned by t needs s * (|cos t| + |sin t|) to contain it -- at 45 degrees that
 * is s * sqrt(2). Using the unrotated side would clip the corners of every angled hole.
 */
export function boundsOf(fields: readonly PlacedField[]): Bounds {
  // Seeded at zero rather than +/-Infinity: an empty course is a degenerate map, not a broken
  // one, and an infinite bound propagates NaN through the projection.
  if (fields.length === 0) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const field of fields) {
    const sweep =
      (field.fieldSize / 2) * (Math.abs(Math.cos(field.rotation)) + Math.abs(Math.sin(field.rotation)));
    if (field.offsetX - sweep < minX) minX = field.offsetX - sweep;
    if (field.offsetZ - sweep < minZ) minZ = field.offsetZ - sweep;
    if (field.offsetX + sweep > maxX) maxX = field.offsetX + sweep;
    if (field.offsetZ + sweep > maxZ) maxZ = field.offsetZ + sweep;
  }
  return { minX, minZ, maxX, maxZ };
}

export interface CourseLayout {
  readonly placements: readonly HolePlacement[];
  readonly clubhouse: Vec2;
}

export interface CorridorConflict {
  readonly a: number;
  readonly b: number;
  readonly clearanceM: number;
}

export interface LayoutReport {
  /** Largest green-to-next-tee distance within a nine, in metres. */
  readonly maxTransitionM: number;
  /** How far hole 9's cup and hole 18's cup finish from the clubhouse. */
  readonly frontReturnM: number;
  readonly backReturnM: number;
  /** Closest approach between any two non-consecutive holes' corridors, away from the clubhouse
   *  apron where they are meant to converge. */
  readonly minClearanceM: number;
  readonly conflicts: readonly CorridorConflict[];
}

/** Measures the properties a layout is supposed to have, so they can be asserted rather than
 *  assumed. Reports; never throws. */
export function inspectLayout(holes: readonly LayoutHole[], layout: CourseLayout): LayoutReport {
  const byIndex = new Map(layout.placements.map((p) => [p.index, p]));
  const at = (hole: LayoutHole, local: Vec2): Vec2 => {
    const p = byIndex.get(hole.index);
    if (!p) return local;
    const cos = Math.cos(p.rotation);
    const sin = Math.sin(p.rotation);
    return { x: p.offsetX + local.x * cos - local.z * sin, z: p.offsetZ + local.x * sin + local.z * cos };
  };

  let maxTransitionM = 0;
  for (const [from, to] of [...consecutive(0, 8), ...consecutive(9, 17)]) {
    const a = holes.find((h) => h.index === from);
    const b = holes.find((h) => h.index === to);
    if (!a || !b) continue;
    const green = at(a, a.cup);
    const tee = at(b, b.tee);
    maxTransitionM = Math.max(maxTransitionM, Math.hypot(green.x - tee.x, green.z - tee.z));
  }

  const returnOf = (index: number): number => {
    const hole = holes.find((h) => h.index === index);
    if (!hole) return 0;
    const cup = at(hole, hole.cup);
    return Math.hypot(cup.x - layout.clubhouse.x, cup.z - layout.clubhouse.z);
  };

  // Corridors are compared only between holes that are not played back to back. Consecutive holes
  // are *supposed* to meet -- a green sits TRANSITION_M from the next tee by construction -- so
  // measuring them would report the design as a defect.
  const centrelines = new Map<number, Vec2[]>();
  for (const hole of holes) {
    const p = byIndex.get(hole.index);
    if (p) centrelines.set(hole.index, placedControl(hole, p));
  }

  let minClearanceM = Infinity;
  const conflicts: CorridorConflict[] = [];
  const indices = [...centrelines.keys()].sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const a = indices[i]!;
      const b = indices[j]!;
      if (b - a === 1) continue;
      const { distance, at } = polylineClearance(centrelines.get(a)!, centrelines.get(b)!);
      // Holes meeting on the clubhouse apron is the returning-nines shape, not a collision.
      const onApron =
        Math.hypot(at.x - layout.clubhouse.x, at.z - layout.clubhouse.z) <= CLUBHOUSE_APRON_M;
      if (onApron) continue;
      minClearanceM = Math.min(minClearanceM, distance);
      if (distance < CORRIDOR_CLEARANCE_M) conflicts.push({ a, b, clearanceM: distance });
    }
  }

  return {
    maxTransitionM,
    frontReturnM: returnOf(8),
    backReturnM: returnOf(17),
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0,
    conflicts,
  };
}

function consecutive(first: number, last: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = first; i < last; i++) out.push([i, i + 1]);
  return out;
}
