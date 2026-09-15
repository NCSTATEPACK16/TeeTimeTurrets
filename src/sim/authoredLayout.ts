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
 * **What the fit cost, measured rather than asserted.** All fifteen bearings the drawing states land
 * within 40 degrees, the worst at 33. Field centres moved 182 m from their plat markers on average
 * and 373 m at the worst (hole 12) -- that is the price of holding bearings close, and bearings are
 * what the drawing actually states. Holes 10, 12 and 17 are read off the drawn fairway rather than
 * stated and are held loosely. Whether what is left still reads as this course is a question for the
 * eighteen hole plans and a human, not for an assertion.
 *
 * **Two corrections to the plat trace are baked in, and both came from the owner rather than from
 * arithmetic.** The trace's `Plays` column came from the spec, not the drawing, and it is wrong
 * twice:
 *
 * - **Hole 16 plays north, not south** -- up the eastern side of the large north-west pond. As
 *   recorded the back nine's chords drift 807 m southward, which eight transitions cannot absorb, so
 *   the nine could not return at all.
 * - **Hole 7 plays north**, parallel to 2, 3, 5 and 8, finishing beside hole 4's green. The eastern
 *   half of this course is a set of parallel corridors, and a hole crossing them is a hole crossing
 *   live ground.
 *
 * A third reading was tried and rejected: hole 14 reversed to north. It satisfies the back nine's
 * closure -- so do three other single reversals, which is exactly why closure cannot choose between
 * them -- and it shipped for one commit before the drawing said otherwise.
 *
 * **Two transitions are ridden, not walked, and the layout is fitted knowing it.** From hole 7 you
 * ride back past hole 4's green to hole 8, on a path that forks there to serve hole 5's tee as well;
 * from 16 to 17 you cross a public road. Holding those two to `TRANSITION_MAX_M` like the other
 * fourteen bends the routing around a constraint the real course does not have.
 *
 * Provenance for the routing is recorded in `LICENSES.md`.
 */

import type { Vec2 } from "./mapGeometry";
import type { CourseLayout, HolePlacement } from "./courseLayout";
import { metresNorthOf } from "./courseBarrier";
import type { SouthBoundary } from "./courseBarrier";

/**
 * The clubhouse, on the southern boundary and west of centre, with holes 1, 9, 10 and 18 around it.
 *
 * South of *every* hole's field centre, which is what puts the course on one side of it rather than
 * wrapped around it the way the solver's two nines are.
 */
export const AUTHORED_CLUBHOUSE: Vec2 = { x: -241.2, z: -477.3 };

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
export const AUTHORED_SOUTH_BOUNDARY: SouthBoundary = {
  a: { x: -613.2, z: -405.3 },
  b: { x: 412.8, z: -687.3 },
};

/**
 * Metres north of the southern boundary; negative is on the road side of it.
 *
 * The signed distance to `AUTHORED_SOUTH_BOUNDARY`'s line, positive on the playable side. The
 * arithmetic itself lives in `courseBarrier.ts` and this only binds it to the course's own traced
 * line, so the test asserting the course is north of the road and the clamp keeping the cart there
 * cannot disagree about which side is which.
 */
export function metresNorthOfBoundary(x: number, z: number): number {
  return metresNorthOf(AUTHORED_SOUTH_BOUNDARY, x, z);
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
  { index: 0, offsetX: 81.0, offsetZ: -410.2, rotation: 0.1866 },// hole 1    11 deg (plat 0)
  { index: 1, offsetX: 423.6, offsetZ: -191.6, rotation: 1.1266 },// hole 2    65 deg (plat 90)
  { index: 2, offsetX: 541.9, offsetZ: 176.5, rotation: 1.4634 },// hole 3    84 deg (plat 90)
  { index: 3, offsetX: 450.7, offsetZ: 368.0, rotation: -2.9434 },// hole 4  -169 deg (plat 180)
  { index: 4, offsetX: 418.7, offsetZ: 162.4, rotation: -1.188 },// hole 5   -68 deg (plat -90)
  { index: 5, offsetX: 374.2, offsetZ: -14.9, rotation: 3.0732 },// hole 6   176 deg (plat 180)
  { index: 6, offsetX: 304.6, offsetZ: 211.0, rotation: 1.4329 },// hole 7    82 deg (plat 90)
  { index: 7, offsetX: 203.0, offsetZ: 75.5, rotation: -1.807 },// hole 8  -104 deg (plat -90)
  { index: 8, offsetX: -23.0, offsetZ: -264.4, rotation: -2.5721 },// hole 9  -147 deg (plat 180)
  { index: 9, offsetX: -355.0, offsetZ: -329.9, rotation: 2.2232 },// hole 10  127 deg (plat 133?)
  { index: 10, offsetX: -491.9, offsetZ: -94.8, rotation: 1.9926 },// hole 11  114 deg (plat 90)
  { index: 11, offsetX: -482.1, offsetZ: 203.9, rotation: 0.9184 },// hole 12   53 deg (plat 40?)
  { index: 12, offsetX: -372.0, offsetZ: 205.4, rotation: -1.0626 },// hole 13  -61 deg (plat -90)
  { index: 13, offsetX: -317.4, offsetZ: -150.3, rotation: -1.4681 },// hole 14  -84 deg (plat -90)
  { index: 14, offsetX: -253.6, offsetZ: -171.6, rotation: 1.5839 },// hole 15   91 deg (plat 90)
  { index: 15, offsetX: -265.3, offsetZ: 212.2, rotation: 1.6114 },// hole 16   92 deg (plat 90)
  { index: 16, offsetX: -82.0, offsetZ: 162.8, rotation: -1.8452 },// hole 17 -106 deg (plat -49?)
  { index: 17, offsetX: -155.3, offsetZ: -149.9, rotation: -1.772 },// hole 18 -102 deg (plat -90)
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
