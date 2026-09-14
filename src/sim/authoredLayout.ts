/**
 * Where the eighteen authored holes sit in the course frame, and where the clubhouse is.
 *
 * **Why this module exists.** `solveCourseLayout` discovers a layout: it fits nine chords to a
 * circle, relaxes them, and falls back when the relaxation crosses a line. That is the right shape
 * for a course nobody has drawn. This course has been drawn, so its placements are data, and the
 * solver comes off the shipped path (see its own doc comment).
 *
 * **Frame.** Course `+x` is east and `+z` is north. Each hole's own frame runs along its local `+x`
 * from tee to cup with the dog-leg apex offset in `z` (`authoredCourse.ts`); `rotation` turns that
 * frame to the hole's bearing, so `rotation: 0` plays east and `Math.PI / 2` plays north. `offsetX`
 * and `offsetZ` are where the hole's own origin -- the midpoint of its tee and cup -- lands.
 *
 * **These numbers are a fit, not a tracing, and that distinction is load-bearing.** The plat has no
 * scale bar and its drawn fairways are about a fifth shorter than the scorecard they belong to, so
 * hole *lengths* (from the card) and hole *positions* (from the drawing) cannot both be honoured.
 * What was traced off the plat is each hole's bearing and its rough position; what decided the
 * final numbers is a one-time fit that held the bearings near their traced values while making the
 * routing playable -- two nines that return to the clubhouse, sixteen green-to-tee walks inside
 * `TRANSITION_MAX_M`, no two non-consecutive corridors inside `CORRIDOR_CLEARANCE_M`, no tee on the
 * previous hole's fairway, and no cup within 25 m of any other hole's water. The fit is authoring;
 * its output is the literals below.
 *
 * **What the fit cost, measured rather than asserted.** Of the fifteen bearings the plat states,
 * eleven land within 37 degrees; four do not -- holes 12, 14, 15 and 16, at 71, 74, 49 and 68
 * degrees. Field centres moved 170 m from their plat markers on average and 343 m at the worst
 * (hole 12). Holes 6, 10 and 17 had no stated bearing to miss. Whether what is left still reads as
 * this course is a question for the eighteen hole plans and a human, not for an assertion -- see
 * `docs/COURSE_PIPELINE.md` and the plan's ledger.
 *
 * **One correction to the plat trace is baked in here: hole 14 plays north, not south.** Recorded as
 * "south", it makes the back nine's chords drift 807 m southward, which eight green-to-tee walks
 * cannot absorb -- the nine simply cannot return. Reversing it, and nothing else, closes the nine to
 * 33 m, and the direction from hole 14's plat marker to hole 15's independently implies +72 degrees.
 * Hole 13, the other candidate, is confirmed correct at -86 degrees implied against -90 recorded.
 *
 * Provenance for the routing is recorded in `LICENSES.md`.
 */

import type { Vec2 } from "./mapGeometry";
import type { CourseLayout, HolePlacement } from "./courseLayout";

/**
 * The clubhouse, on the southern boundary and west of centre, with holes 1, 9, 10 and 18 around it.
 *
 * South of *every* hole's field centre, which is what puts the course on one side of it rather than
 * wrapped around it the way the solver's two nines are.
 */
export const AUTHORED_CLUBHOUSE: Vec2 = { x: -243.4, z: -533.3 };

/**
 * County Home Road, the southern boundary, as a line rather than a limit.
 *
 * **It is diagonal**, running east and south across the bottom of the plat, so a clamp to a
 * constant `z` is wrong in both directions: it would cut the course short at the western end and
 * leave a wedge of playable ground hanging over the road at the eastern end. The barrier that keeps
 * the cart off it reads this line (`courseBarrier.ts`); the geometry lives here because it is
 * traced off the same plat as the placements and must not drift away from them.
 *
 * The plat also shows Files Road on the south-east corner. It is not represented here -- see
 * `docs/DECISIONS.md`.
 */
export const AUTHORED_SOUTH_BOUNDARY: { readonly a: Vec2; readonly b: Vec2 } = {
  a: { x: -615.4, z: -461.3 },
  b: { x: 410.6, z: -743.3 },
};

/**
 * Metres north of the southern boundary; negative is on the road side of it.
 *
 * The signed distance to `AUTHORED_SOUTH_BOUNDARY`'s line, positive on the playable side. Lives
 * beside the line rather than with the barrier so that the test asserting the course is north of
 * the road and the clamp keeping the cart there cannot disagree about which side is which.
 */
export function metresNorthOfBoundary(x: number, z: number): number {
  const { a, b } = AUTHORED_SOUTH_BOUNDARY;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Normal (-dz, dx) points +z for a line running east and south, which is the playable side.
  return ((x - a.x) * -dz + (z - a.z) * dx) / Math.hypot(dx, dz);
}

/**
 * The eighteen placements, in hole order.
 *
 * `rotation` is radians in the course frame. The comment on each line is the bearing in degrees
 * beside the bearing the plat states for that hole, so a later edit can see at a glance how far the
 * number already sits from the drawing. A `?` marks a hole the plat records only as "short", whose
 * bearing was inferred from the direction to the next hole's marker rather than stated.
 */
export const AUTHORED_PLACEMENTS: readonly HolePlacement[] = [
  { index: 0, offsetX: 75.4, offsetZ: -447.3, rotation: 0.2728 },// hole 1    16 deg (plat 0)
  { index: 1, offsetX: 419.7, offsetZ: -209.2, rotation: 1.0727 },// hole 2    61 deg (plat 90)
  { index: 2, offsetX: 561.7, offsetZ: 152.6, rotation: 1.377 },// hole 3    79 deg (plat 90)
  { index: 3, offsetX: 496.8, offsetZ: 370.1, rotation: 3.097 },// hole 4   177 deg (plat 180)
  { index: 4, offsetX: 442.5, offsetZ: 184.0, rotation: -1.2594 },// hole 5   -72 deg (plat -90)
  { index: 5, offsetX: 428.4, offsetZ: -60.9, rotation: -2.3306 },// hole 6  -134 deg (plat 91?)
  { index: 6, offsetX: 304.1, offsetZ: 71.5, rotation: 1.7205 },// hole 7    99 deg (plat 90)
  { index: 7, offsetX: 188.4, offsetZ: 37.9, rotation: -1.7864 },// hole 8  -102 deg (plat -90)
  { index: 8, offsetX: -27.6, offsetZ: -312.7, rotation: -2.5029 },// hole 9  -143 deg (plat 180)
  { index: 9, offsetX: -354.4, offsetZ: -378.8, rotation: 2.1839 },// hole 10  125 deg (plat 109?)
  { index: 10, offsetX: -497.3, offsetZ: -145.0, rotation: 2.0686 },// hole 11  119 deg (plat 90)
  { index: 11, offsetX: -543.3, offsetZ: 176.3, rotation: 1.2461 },// hole 12   71 deg (plat 0)
  { index: 12, offsetX: -483.1, offsetZ: 184.6, rotation: -1.8304 },// hole 13 -105 deg (plat -90)
  { index: 13, offsetX: -315.4, offsetZ: 55.0, rotation: 0.2733 },// hole 14   16 deg (plat 90)
  { index: 14, offsetX: -269.9, offsetZ: 169.6, rotation: 2.4288 },// hole 15  139 deg (plat 90)
  { index: 15, offsetX: -225.1, offsetZ: 261.5, rotation: -0.3827 },// hole 16  -22 deg (plat -90)
  { index: 16, offsetX: -57.0, offsetZ: 100.0, rotation: -1.8159 },// hole 17 -104 deg (plat -98?)
  { index: 17, offsetX: -143.8, offsetZ: -209.2, rotation: -1.8348 },// hole 18 -105 deg (plat -90)
];

/**
 * The shipped course's layout. Data, so it takes no arguments and cannot fail.
 *
 * Returns a fresh object each call rather than a shared constant: `CourseLayout` is `readonly`
 * throughout, but a single instance handed to every caller is the shape of a defect this project
 * would rather not have to rule out at all.
 */
export function authoredCourseLayout(): CourseLayout {
  return { placements: AUTHORED_PLACEMENTS.map((p) => ({ ...p })), clubhouse: { ...AUTHORED_CLUBHOUSE } };
}
