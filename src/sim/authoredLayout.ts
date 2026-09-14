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
 * **What the fit cost, measured rather than asserted.** Of the fourteen bearings the plat draws
 * unambiguously, thirteen land within 40 degrees; the one that does not is hole 16, at 43. Field
 * centres moved 186 m from their plat markers on average and 382 m at the worst (hole 12). Holes 6,
 * 10, 12 and 17 are read off the drawn fairway rather than stated, and are held loosely for that
 * reason. Whether what is left still reads as this course is a question for the eighteen hole plans
 * and a human, not for an assertion -- see `docs/COURSE_PIPELINE.md` and the plan's ledger.
 *
 * **One correction to the plat trace is baked in here: hole 16 plays north, not south.** The trace's
 * `Plays` column came from the spec rather than from the drawing, and as recorded the back nine's
 * chords drift 807 m southward -- eight green-to-tee walks absorb at most ~800 m, and only if they
 * all point the same way, so the nine cannot return at all. Reversing hole 16 closes it, and the
 * drawing shows why: 16 runs *up* the eastern side of the large north-west pond, from hole 15's
 * finish toward hole 17, rather than down it. Hole 14 is the other arithmetically valid candidate
 * and was wrong: reversing it also closes the nine, but the drawing has 14 playing south, and
 * reversing 16 closes the *front* nine better too (50 m per walk against 61 m).
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
export const AUTHORED_CLUBHOUSE: Vec2 = { x: -250.8, z: -478.1 };

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
  a: { x: -622.8, z: -406.1 },
  b: { x: 403.2, z: -688.1 },
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
  { index: 0, offsetX: 68.0, offsetZ: -391.8, rotation: 0.2734 }, // hole 1    16 deg (plat 0)
  { index: 1, offsetX: 412.3, offsetZ: -153.5, rotation: 1.0722 }, // hole 2    61 deg (plat 90)
  { index: 2, offsetX: 554.4, offsetZ: 207.8, rotation: 1.3771 }, // hole 3    79 deg (plat 90)
  { index: 3, offsetX: 489.5, offsetZ: 425.7, rotation: 3.0953 }, // hole 4   177 deg (plat 180)
  { index: 4, offsetX: 435.1, offsetZ: 239.8, rotation: -1.2592 }, // hole 5   -72 deg (plat -90)
  { index: 5, offsetX: 421.4, offsetZ: -5.4, rotation: -2.3246 }, // hole 6  -133 deg (plat 180?)
  { index: 6, offsetX: 296.7, offsetZ: 126.5, rotation: 1.723 }, // hole 7    99 deg (plat 90)
  { index: 7, offsetX: 180.8, offsetZ: 92.8, rotation: -1.7847 }, // hole 8  -102 deg (plat -90)
  { index: 8, offsetX: -35.0, offsetZ: -257.6, rotation: -2.5038 }, // hole 9  -143 deg (plat 180)
  { index: 9, offsetX: -372.5, offsetZ: -336.0, rotation: 2.278 }, // hole 10  131 deg (plat 133?)
  { index: 10, offsetX: -516.8, offsetZ: -104.6, rotation: 2.0422 }, // hole 11  117 deg (plat 90)
  { index: 11, offsetX: -512.9, offsetZ: 192.8, rotation: 0.9236 }, // hole 12   53 deg (plat 40?)
  { index: 12, offsetX: -402.9, offsetZ: 194.7, rotation: -1.0574 }, // hole 13  -61 deg (plat -90)
  { index: 13, offsetX: -339.8, offsetZ: -172.7, rotation: -1.4889 }, // hole 14  -85 deg (plat -90)
  { index: 14, offsetX: -276.6, offsetZ: -196.1, rotation: 1.5615 }, // hole 15   89 deg (plat 90)
  { index: 15, offsetX: -189.8, offsetZ: 132.6, rotation: 0.8156 }, // hole 16   47 deg (plat 90)
  { index: 16, offsetX: -60.1, offsetZ: 157.5, rotation: -1.8767 }, // hole 17 -108 deg (plat 0?)
  { index: 17, offsetX: -152.1, offsetZ: -152.4, rotation: -1.85 }, // hole 18 -106 deg (plat -90)
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
