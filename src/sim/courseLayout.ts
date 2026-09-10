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
 * it. A `HolePlacement` is one; a `PlacedField` is one with a size attached.
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

/** Metres from a green to the next tee. The walk, and what keeps the loop from being a polygon
 *  with its corners at the cups. */
export const TRANSITION_M = 30;

/** Metres between the 1st tee and the 10th, so the two nines leave from opposite sides of the
 *  clubhouse rather than from the same square metre. */
export const CLUBHOUSE_GAP_M = 90;

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

/** Lays the holes out as two returning nines through a clubhouse at the origin. */
export function solveCourseLayout(holes: readonly LayoutHole[]): CourseLayout {
  const clubhouse: Vec2 = { x: 0, z: 0 };
  const front = holes.slice(0, 9);
  const back = holes.slice(9, 18);

  const chordsOf = (nine: readonly LayoutHole[]): number[] =>
    nine.flatMap((h) => [Math.hypot(h.cup.x - h.tee.x, h.cup.z - h.tee.z), TRANSITION_M]);

  const placements: HolePlacement[] = [];

  if (front.length > 0) {
    const radius = loopRadius(chordsOf(front));
    // Centre directly -Z of the clubhouse so the loop passes through it, and wind one way.
    placements.push(
      ...placeNine(front, { x: clubhouse.x, z: clubhouse.z - radius }, radius, Math.PI / 2, 1),
    );
  }
  if (back.length > 0) {
    const radius = loopRadius(chordsOf(back));
    // The mirror image, +Z of the clubhouse and winding the other way, so the two nines occupy
    // opposite sides and meet only where the clubhouse is. Offset along X by the clubhouse gap
    // so the 10th tee sits beside the 1st rather than on it.
    placements.push(
      ...placeNine(
        back,
        { x: clubhouse.x + CLUBHOUSE_GAP_M, z: clubhouse.z + radius },
        radius,
        -Math.PI / 2,
        -1,
      ),
    );
  }

  return { placements, clubhouse };
}

/** A hole's corridor centreline, in course-frame metres. */
function placedControl(hole: LayoutHole, placement: HolePlacement): Vec2[] {
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
function polylineClearance(a: readonly Vec2[], b: readonly Vec2[]): { distance: number; at: Vec2 } {
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
