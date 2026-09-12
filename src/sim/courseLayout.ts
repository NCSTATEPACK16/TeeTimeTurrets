/**
 * Where the eighteen holes actually are, relative to each other and to the clubhouse.
 *
 * `src/sim/course.ts` is explicit that "a course is nine holes, not one nine-hole map": every
 * `HoleSpec` owns a square field centred on its own origin, and nothing has ever said where two
 * holes sit relative to one another. This module is the missing frame. It does not build terrain
 * and it does not touch `Sim` -- it answers one question, in data, so the answer can be argued
 * with before anything expensive is built on it.
 *
 * **Returning nines.** Each nine is laid out as a closed loop through the clubhouse: hole 1 tees
 * off there, hole 9 comes back to it, hole 10 tees off beside it and hole 18 comes back. That is
 * the shape of most real courses and it is the one the brief asked for.
 *
 * **The construction is a chord fit, not a search.** Each hole is a segment of known length -- the
 * straight line from its tee to its cup -- and a nine is nine of those plus the walk between them,
 * joined end to end and closed. Fitting a closed polygon of fixed-length segments to a circle has
 * a single unknown, the radius, and the total subtended angle falls monotonically as the radius
 * grows, so one bisection finds it. There is no search to fail and no seed to get unlucky with:
 * for any set of hole lengths there is exactly one radius that closes the loop.
 *
 * **Fields overlap; corridors must not.** A par 4's field is 220 m square while its playable
 * corridor is a ribbon about 40 m wide, so nine fields cover far more ground than the loop they
 * sit on (47 ha of field into a 36 ha loop) while the corridors themselves use 7.5 ha of it. The
 * fields are expected to overlap and blend into shared rough. The constraint that matters, and
 * the one `inspectLayout` measures, is that two holes' corridors never run into each other.
 */

import type { Vec2 } from "./mapGeometry";
import { polishCourse, relaxNine } from "./courseRelaxation";
import {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  chordOf,
  placedControl,
  polylineClearance,
  toCourseFrame,
  type CourseFrame,
  type HolePlacement,
  type LayoutHole,
} from "./courseGeometry";

// Re-exported rather than imported-and-forgotten: every existing caller (courseLayout.test.ts,
// course.ts) reaches these through "./courseLayout", and courseGeometry.ts exists only to give
// this module and courseRelaxation.ts a shared upstream without either importing the other (see
// courseGeometry.ts's own doc comment, and tools/importCycles.test.mjs). Moving the file must not
// move where anyone else imports it from.
export {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  chordOf,
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

/** Metres between the 1st tee and the 10th, so the two nines leave from opposite sides of the
 *  clubhouse rather than from the same square metre. */
export const CLUBHOUSE_GAP_M = 90;

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

/**
 * The radius of the circle on which chords of the given lengths close a loop exactly.
 *
 * A chord of length c on a circle of radius r subtends 2*asin(c / 2r). Closing the loop means
 * those angles sum to 2*pi. The sum falls monotonically as r grows -- a bigger circle bends less
 * per metre -- so a bisection between "the longest chord is a diameter" and "far too big" lands
 * on the single radius that works.
 */
export function loopRadius(chords: readonly number[]): number {
  const longest = Math.max(...chords);
  const perimeter = chords.reduce((sum, c) => sum + c, 0);

  // Below half the longest chord there is no circle that contains it; above the perimeter the
  // circle is far too big for the chords to wrap it. The answer is strictly between.
  let lo = longest / 2;
  let hi = Math.max(perimeter, longest);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    // Guard the domain: a chord fractionally longer than the diameter would give asin(> 1).
    let total = 0;
    for (const c of chords) total += 2 * Math.asin(Math.min(1, c / (2 * mid)));
    if (total > Math.PI * 2) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Lays one nine out around `centre`, starting at `startAngle` and winding in `direction`. */
function placeNine(
  holes: readonly LayoutHole[],
  centre: Vec2,
  radius: number,
  startAngle: number,
  direction: number,
): HolePlacement[] {
  const out: HolePlacement[] = [];
  let angle = startAngle;

  const advance = (chord: number): void => {
    angle += direction * 2 * Math.asin(Math.min(1, chord / (2 * radius)));
  };
  const pointAt = (a: number): Vec2 => ({
    x: centre.x + radius * Math.cos(a),
    z: centre.z + radius * Math.sin(a),
  });

  for (const hole of holes) {
    const teePoint = pointAt(angle);
    advance(Math.hypot(hole.cup.x - hole.tee.x, hole.cup.z - hole.tee.z));
    const cupPoint = pointAt(angle);
    advance(TRANSITION_M);

    // Turn the hole so its own tee-to-cup line lies along the chord it was fitted to, then slide
    // it so the tee lands on the chord's start. Rotation first, translation second -- the offset
    // is where the hole's local origin ends up, which depends on how far the rotation moved it.
    const wanted = Math.atan2(cupPoint.z - teePoint.z, cupPoint.x - teePoint.x);
    const own = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
    const rotation = wanted - own;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    out.push({
      index: hole.index,
      offsetX: teePoint.x - (hole.tee.x * cos - hole.tee.z * sin),
      offsetZ: teePoint.z - (hole.tee.x * sin + hole.tee.z * cos),
      rotation,
    });
  }
  return out;
}

/**
 * How many lobes each nine's loop is folded into.
 *
 * Three over nine holes is three holes a lobe, which is what makes the routing read as a golf
 * course rather than a ring: a hole goes out along one side of a lobe and the next comes back
 * along the other, so their corridors run anti-parallel with a tree belt between them. Pinehurst
 * No. 2's 1 and 18 are that shape, and so are its 12, 13 and 14.
 *
 * A circle is this with zero lobes, and it was the shape before: nine holes at even angular steps,
 * every corridor pointing 40 degrees off its neighbour and no two ever running together.
 */
export const COURSE_LOBES = 3;

/**
 * How deep the lobes cut, as a fraction of the loop's mean radius.
 *
 * The radius runs `base * (1 +- COURSE_LOBE_DEPTH)`, so at 0.5 the far end of a lobe is three
 * times the radius of its neck. Deeper makes the out and back legs more nearly parallel and
 * closer together; past about 0.6 the necks pinch tightly enough that `inspectLayout` starts
 * reporting conflicts between lobes, which is the constraint that bounds this number rather than
 * a matter of taste.
 */
export const COURSE_LOBE_DEPTH = 0.5;

/** Holes to a lobe: out, across the end, back. Nine holes make three lobes exactly. */
const HOLES_PER_LOBE = 3;

/**
 * How far a lobe's return leg runs from the way out.
 *
 * Well clear of `CORRIDOR_CLEARANCE_M`, the floor a conflict is reported at, and inside the 150 m
 * the shape test calls neighbouring -- a pair further apart than that is two holes that happen to
 * point opposite ways rather than a lobe.
 */
const LOBE_WIDTH_M = 110;

/**
 * Lays one nine out as lobes that leave the clubhouse and come back to it.
 *
 * **Constructed leg by leg rather than fitted to a curve, and the first attempt at this is why.**
 * A lobed polar curve looked like the right shape on paper, but a nine has to fit roughly two
 * kilometres of holes around it, which makes the mean radius about 300 m -- the same order as a
 * par 5. Every chord then cut straight across a lobe instead of running along one, and the
 * routing came out as a wandering polygon whose ninth hole finished 269 m from the clubhouse.
 * The lobes have to be longer than they are wide, and that is a statement about legs, not radii.
 *
 * Each lobe is three holes: **out** along the lobe's bearing, **across** its far end, and
 * **back** aimed at the clubhouse. The out and back legs are what the whole exercise is for --
 * they run anti-parallel, separated by however long the crossing hole was, which is the tree belt
 * between them. Augusta's 11-12-13 is exactly this figure, and so is Pinehurst's 12-13-14.
 *
 * Aiming every back leg at the clubhouse is what keeps the nine returning: the ninth hole points
 * home by construction rather than by the loop happening to close, which is the property the
 * circular version had to solve a bisection for.
 */
function placeNineAsLobes(
  holes: readonly LayoutHole[],
  hub: Vec2,
  outward: number,
  direction: number,
): HolePlacement[] {
  // Shape first, closure second, and deliberately not the same knob. An earlier attempt solved the
  // crossing leg for closure, which left the gap between a lobe's out and back legs to be whatever
  // closure did not need -- the two fought over one degree of freedom and the routing came back
  // with nine corridors inside 1.6 m of each other. Now the legs are laid to a fixed separation and
  // a single scalar, the fan between lobes, is scanned until the ninth cup lands on the clubhouse.
  let best: HolePlacement[] = [];
  let bestMiss = Infinity;
  for (let step = 0; step <= FAN_STEPS; step++) {
    const fan = FAN_MIN + ((FAN_MAX - FAN_MIN) * step) / FAN_STEPS;
    const tried = layNine(holes, hub, outward, direction, fan);
    const miss = Math.hypot(tried.end.x - hub.x, tried.end.z - hub.z);
    if (miss < bestMiss) {
      bestMiss = miss;
      best = tried.placements;
    }
  }
  return best;
}

/** The shipped-and-measured construction from before this module had lobes: chords fit exactly
 *  to a circle through the hub (docs/RESEARCH-ROUTING.md, "What ships today"). Deterministic,
 *  closes exactly by the bisection in `loopRadius`, zero corridor conflicts on every seed
 *  measured -- the fallback when relaxation does not land a nine's return within its threshold. */
function placeNineOnCircle(holes: readonly LayoutHole[], hub: Vec2, direction: number): HolePlacement[] {
  if (holes.length === 0) return [];
  const chords = holes.flatMap((h) => [chordOf(h), TRANSITION_M]);
  const radius = loopRadius(chords);
  const centre: Vec2 = { x: hub.x, z: hub.z - direction * radius };
  const startAngle = direction * (Math.PI / 2);
  return placeNine(holes, centre, radius, startAngle, direction);
}

/** Relaxation's initial guess, then relaxation itself; falls back to the exact circle
 *  construction if the result still misses its return threshold. */
function placeNineWithFallback(
  holes: readonly LayoutHole[],
  hub: Vec2,
  clubhouse: Vec2,
  outward: number,
  direction: number,
  returnLimitM: number,
): HolePlacement[] {
  if (holes.length === 0) return [];

  const seeded = placeNineAsLobes(holes, hub, outward, direction);
  // The nine's intended side of the clubhouse line: `outward` is the bearing this nine leaves on
  // (+Z for the front nine, -Z for the back), so its sign is the ground truth for which side is
  // "correct" -- not something to re-derive from the seed, which can itself lean either way for
  // real, irregular hole lengths.
  const relaxed = relaxNine(holes, seeded, hub, clubhouse, Math.sign(Math.sin(outward)));

  const lastHole = holes[holes.length - 1]!;
  const lastPlacement = relaxed[relaxed.length - 1]!;
  const lastCup: Vec2 = { x: 0, z: 0 };
  toCourseFrame(lastPlacement, lastHole.cup.x, lastHole.cup.z, lastCup);
  const miss = Math.hypot(lastCup.x - clubhouse.x, lastCup.z - clubhouse.z);

  return miss <= returnLimitM ? relaxed : placeNineOnCircle(holes, hub, direction);
}

/** Narrowest and widest angle between neighbouring lobes the closure scan will consider. */
const FAN_MIN = (25 * Math.PI) / 180;
const FAN_MAX = (150 * Math.PI) / 180;
const FAN_STEPS = 400;

/**
 * One nine at a given fan, by the shape rules alone.
 *
 * Each lobe is out along its bearing, across its end, and back **anti-parallel to the out leg** --
 * not merely "homeward", which is what lets the pair sit a fixed distance apart. The crossing leg
 * is angled just far enough off the lobe bearing that its lateral component is `LOBE_WIDTH_M`, so
 * the return runs that far to one side of the way out. That gap is the tree belt between them, and
 * it is the whole reason the routing reads as a golf course rather than a spider.
 */
function layNine(
  holes: readonly LayoutHole[],
  hub: Vec2,
  outward: number,
  direction: number,
  fan: number,
): { placements: HolePlacement[]; end: Vec2 } {
  const placements: HolePlacement[] = [];
  const lobes = Math.ceil(holes.length / HOLES_PER_LOBE);
  let cursor: Vec2 = { x: hub.x, z: hub.z };
  let end: Vec2 = { x: hub.x, z: hub.z };

  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i]!;
    const leg = i % HOLES_PER_LOBE;
    const lobe = Math.floor(i / HOLES_PER_LOBE);
    const beta = outward + direction * fan * (lobe - (lobes - 1) / 2);
    const length = chordOf(hole);

    let bearing: number;
    if (leg === 0) {
      bearing = beta;
    } else if (leg === 1) {
      // Angled off the lobe bearing so this leg shifts the walk sideways by LOBE_WIDTH_M. A short
      // crossing hole cannot reach that far, so the angle saturates at a right angle and its pair
      // ends up closer together than asked -- narrower, never crossed.
      const reach = length + TRANSITION_M;
      bearing = beta + direction * Math.asin(Math.min(1, LOBE_WIDTH_M / reach));
    } else {
      bearing = beta + Math.PI;
    }

    const own = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
    const rotation = bearing - own;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    placements.push({
      index: hole.index,
      offsetX: cursor.x - (hole.tee.x * cos - hole.tee.z * sin),
      offsetZ: cursor.z - (hole.tee.x * sin + hole.tee.z * cos),
      rotation,
    });

    end = { x: cursor.x + Math.cos(bearing) * length, z: cursor.z + Math.sin(bearing) * length };
    cursor = {
      x: cursor.x + Math.cos(bearing) * (length + TRANSITION_M),
      z: cursor.z + Math.sin(bearing) * (length + TRANSITION_M),
    };
  }
  return { placements, end };
}

/** Which side of the clubhouse line a hole's cup lands on: +1, -1, or 0 exactly on it. */
function cupSide(layout: CourseLayout, hole: LayoutHole): number {
  const placement = layout.placements.find((p) => p.index === hole.index);
  if (!placement) return 0;
  const out: Vec2 = { x: 0, z: 0 };
  toCourseFrame(placement, hole.cup.x, hole.cup.z, out);
  return Math.sign(out.z - layout.clubhouse.z);
}

/**
 * Whether a nine's interior holes (excluding the first and last, which touch the clubhouse apron
 * by design) all land on the same side of the clubhouse line, and the two nines land on opposite
 * sides. The corridor-repulsion push in `polishCourse` resolves a clearance conflict by moving a
 * hole directly away from whatever it collided with -- correct for clearance, blind to which side
 * of the clubhouse that leaves it on. When it pushes a hole across the line, this catches it.
 */
function sidesOpposite(
  layout: CourseLayout,
  front: readonly LayoutHole[],
  back: readonly LayoutHole[],
): boolean {
  const sidesOf = (nine: readonly LayoutHole[]): Set<number> =>
    new Set(nine.slice(1, -1).map((h) => cupSide(layout, h)));
  const frontSides = sidesOf(front);
  const backSides = sidesOf(back);
  if (frontSides.size > 1 || backSides.size > 1) return false;
  const [f] = frontSides;
  const [b] = backSides;
  if (f === undefined || b === undefined) return true;
  return f !== b;
}

/** Lays the holes out as two returning nines through a clubhouse at the origin. */
export function solveCourseLayout(holes: readonly LayoutHole[]): CourseLayout {
  const clubhouse: Vec2 = { x: 0, z: 0 };
  const front = holes.slice(0, 9);
  const back = holes.slice(9, 18);
  const backHub: Vec2 = { x: clubhouse.x + CLUBHOUSE_GAP_M, z: clubhouse.z };

  const perNine: HolePlacement[] = [
    // The loop leaves the clubhouse heading +Z, which puts its centre -Z and its body south.
    ...placeNineWithFallback(front, clubhouse, clubhouse, Math.PI / 2, 1, TRANSITION_M + 1),
    // The mirror image, north of the clubhouse and winding the other way, so the two nines occupy
    // opposite sides and meet only where the clubhouse is. Offset along X by the clubhouse gap
    // so the 10th tee sits beside the 1st rather than on it.
    ...placeNineWithFallback(
      back,
      backHub,
      clubhouse,
      -Math.PI / 2,
      -1,
      CLUBHOUSE_GAP_M + TRANSITION_M + 1,
    ),
  ];

  // relaxNine optimises each nine's corridors against itself; a conflict between a front-nine
  // hole and a back-nine hole (both nines' attractors pull toward the same clubhouse point) is
  // invisible to it, since it never sees the other nine's placements. One further pass, across
  // the whole course, catches that before falling back.
  const placements: HolePlacement[] =
    front.length > 0 && back.length > 0
      ? polishCourse(holes, perNine, clubhouse, backHub, clubhouse, 1, -1)
      : perNine;
  const relaxedLayout: CourseLayout = { placements, clubhouse };

  // If the polish pass still leaves a conflict, or resolved one by pushing a hole across the
  // clubhouse line, fall the whole course back to the circle construction, which is measured
  // conflict-free and correctly sided on every seed tested (docs/RESEARCH-ROUTING.md, "What ships
  // today").
  const needsFallback =
    front.length > 0 &&
    back.length > 0 &&
    (inspectLayout(holes, relaxedLayout).conflicts.length > 0 ||
      !sidesOpposite(relaxedLayout, front, back));
  if (needsFallback) {
    return {
      placements: [...placeNineOnCircle(front, clubhouse, 1), ...placeNineOnCircle(back, backHub, -1)],
      clubhouse,
    };
  }

  return relaxedLayout;
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
