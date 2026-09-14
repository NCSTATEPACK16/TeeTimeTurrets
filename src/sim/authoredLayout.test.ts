import { describe, expect, it } from "vitest";
import {
  AUTHORED_CLUBHOUSE,
  AUTHORED_SOUTH_BOUNDARY,
  authoredCourseLayout,
  metresNorthOfBoundary,
} from "./authoredLayout";
import { authoredCourse } from "./authoredCourse";
import {
  CORRIDOR_CLEARANCE_M,
  TRANSITION_MAX_M,
  inspectLayout,
  toCourseFrame,
  toHoleFrame,
  type LayoutHole,
} from "./courseLayout";
import { pointInPolygon } from "./hazards";

const layout = authoredCourseLayout();
const course = authoredCourse(2026);
const holes: readonly LayoutHole[] = course.holes.map((h) => ({
  index: h.index,
  tee: h.tee,
  cup: h.cup,
  control: h.control,
}));

/** A hole's local point in the course frame. */
function inCourseFrame(index: number, local: { x: number; z: number }): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(layout.placements[index]!, local.x, local.z, out);
  return out;
}

const cupOf = (index: number): { x: number; z: number } => inCourseFrame(index, course.holes[index]!.cup);
const teeOf = (index: number): { x: number; z: number } => inCourseFrame(index, course.holes[index]!.tee);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("the authored layout", () => {
  it("places all eighteen holes once each, in order", () => {
    expect(layout.placements).toHaveLength(18);
    expect(layout.placements.map((p) => p.index)).toEqual([...Array(18).keys()]);
  });

  it("returns both nines to the clubhouse", () => {
    // The one structural property of a returning nine, and authored data can break it as easily
    // as a solver could. 9 and 18 finish near the clubhouse; nothing else has to.
    for (const index of [8, 17]) {
      expect(dist(cupOf(index), AUTHORED_CLUBHOUSE), `hole ${index + 1} cup to clubhouse`).toBeLessThan(180);
    }
  });

  it("tees both nines off at the clubhouse", () => {
    // The other half of a returning nine, and the half the plan's test left out: a nine whose 1st
    // tee is half a mile from its 9th green is not a loop, it is a line that happens to end nearby.
    for (const index of [0, 9]) {
      expect(dist(teeOf(index), AUTHORED_CLUBHOUSE), `hole ${index + 1} tee to clubhouse`).toBeLessThan(180);
    }
  });

  it("puts the clubhouse on the southern boundary, not in the middle", () => {
    // The plat has it against a public road with the course to the north. If it comes out near
    // the centroid of the holes, the placements were laid out around it like the solver's.
    const zs = layout.placements.map((p) => p.offsetZ);
    const centre = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(AUTHORED_CLUBHOUSE.z).toBeLessThan(Math.min(...zs));
    expect(AUTHORED_CLUBHOUSE.z).toBeLessThan(centre);
  });

  it("keeps the whole course on the playable side of the road", () => {
    /**
     * The southern boundary is a *line*, not a limit -- County Home Road runs east and south across
     * the plat. Asserting `offsetZ > someConstant` instead would pass a course that hangs over the
     * road at its eastern end, which is the shape the diagonal makes easy to ship by accident.
     *
     * Corridor control points, not field centres: a field is 220-300 m square and is expected to
     * spill into rough that nobody plays, but a point on a centreline is ground somebody is meant to
     * hit a ball along.
     */
    expect(metresNorthOfBoundary(AUTHORED_CLUBHOUSE.x, AUTHORED_CLUBHOUSE.z)).toBeGreaterThan(0);
    for (const hole of course.holes) {
      for (const [i, p] of hole.control.entries()) {
        const q = inCourseFrame(hole.index, p);
        expect(
          metresNorthOfBoundary(q.x, q.z),
          `hole ${hole.index + 1} control ${i} north of the road`,
        ).toBeGreaterThan(0);
      }
    }
    // Liveness: the predicate has to be capable of reporting the road side, or every assertion
    // above is satisfied by a function that returns a positive constant.
    // Stepped along the line's own normal, not along -z: the road is diagonal, so a 50 m drop in z
    // is only 48 m of perpendicular distance and an assertion written that way measures the slope
    // rather than the predicate.
    const { a, b } = AUTHORED_SOUTH_BOUNDARY;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    expect(metresNorthOfBoundary(mid.x, mid.z)).toBeCloseTo(0, 6);
    expect(metresNorthOfBoundary(mid.x - nx * 50, mid.z - nz * 50)).toBeCloseTo(-50, 6);
    expect(metresNorthOfBoundary(mid.x + nx * 50, mid.z + nz * 50)).toBeCloseTo(50, 6);
  });

  it("keeps non-consecutive corridors apart outside the apron", () => {
    // Use the existing inspector rather than restating its rule. Holes meeting on the clubhouse
    // apron is the returning-nines shape, and `inspectLayout` already forgives exactly that.
    const report = inspectLayout(holes, layout);
    expect(report.conflicts, JSON.stringify(report.conflicts)).toEqual([]);
    // Guard the guard: `conflicts` is empty both when the layout is clean and when the inspector
    // measured nothing at all, and those are not the same result.
    expect(report.minClearanceM).toBeGreaterThan(CORRIDOR_CLEARANCE_M);
    expect(report.minClearanceM).toBeLessThan(Infinity);
  });

  it("never lets one corridor cross another away from the walk between them", () => {
    /**
     * `inspectLayout` cannot see this, and the gap is structural rather than an oversight: it skips
     * *consecutive* holes entirely, because a green sits `TRANSITION_M` from the next tee by
     * construction and measuring that would report the design as a defect. The cost of that
     * exemption is that two consecutive fairways may cross anywhere at all and nothing notices.
     * Four pairs did when these placements were first fitted, one of them across the middle of
     * hole 6 -- a tee shot played over a live fairway.
     *
     * So the property asserted is the one that is actually wanted: corridors may cross only where
     * they are *meant* to be tangled, which is the handover between a green and the next tee.
     * Anywhere else, on any pair, is a fault.
     */
    const HANDOVER = 0.25;
    const placed = course.holes.map((h) => h.control.map((p) => inCourseFrame(h.index, p)));

    /** Where two segments properly cross, as a fraction along each. `null` if they do not. */
    const crossAt = (
      a: { x: number; z: number }, b: { x: number; z: number },
      c: { x: number; z: number }, d: { x: number; z: number },
    ): { t: number; u: number } | null => {
      const side = (p: typeof a, q: typeof a, r: typeof a): number =>
        (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      if ((side(c, d, a) > 0) === (side(c, d, b) > 0)) return null;
      if ((side(a, b, c) > 0) === (side(a, b, d) > 0)) return null;
      const r = { x: b.x - a.x, z: b.z - a.z };
      const u = { x: d.x - c.x, z: d.z - c.z };
      const den = r.x * u.z - r.z * u.x;
      return {
        t: ((c.x - a.x) * u.z - (c.z - a.z) * u.x) / den,
        u: ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den,
      };
    };

    let crossings = 0;
    for (let i = 0; i < 18; i++) {
      for (let j = i + 1; j < 18; j++) {
        const A = placed[i]!;
        const B = placed[j]!;
        for (let p = 0; p + 1 < A.length; p++) {
          for (let q = 0; q + 1 < B.length; q++) {
            const hit = crossAt(A[p]!, A[p + 1]!, B[q]!, B[q + 1]!);
            if (hit === null) continue;
            crossings += 1;
            const alongI = (p + hit.t) / (A.length - 1);
            const alongJ = (q + hit.u) / (B.length - 1);
            // Consecutive only, and only near hole i's cup and hole j's tee -- the handover.
            expect(
              j - i === 1 && alongI > 1 - HANDOVER && alongJ < HANDOVER,
              `hole ${i + 1} and hole ${j + 1} cross at ${(alongI * 100).toFixed(0)}% / ${(alongJ * 100).toFixed(0)}%`,
            ).toBe(true);
          }
        }
      }
    }
    // Guard the guard: a crossing test that never found a crossing has not been exercised, and the
    // handover crossing between 14 and 15 is a real one this routing has.
    expect(crossings).toBeGreaterThan(0);
  });

  it("walks every transition except the two the course rides", () => {
    /**
     * `courseGeometry.ts` says of `TRANSITION_MAX_M`: "Outside this range a transition is a defect,
     * not a variation." That is true of a transition you *walk*, and this course has two you do not.
     * The owner's description of how it is played: after hole 7 you ride back past hole 4's green to
     * reach hole 8 — the path from that green forks, right to 8 and left to 5 — and the ride from
     * hole 16 to hole 17 crosses a public road.
     *
     * So the bound is asserted where it applies and the exceptions are named rather than waived.
     * Asserting the blanket bound instead would be asserting something false about this course;
     * dropping it would stop catching a hole traced 300 m from the previous green. The cart paths
     * are still bounded, because past a few hundred metres they stop being one course.
     */
    const CART_PATHS = new Map([
      ["7->8", "rides back past hole 4's green, where the path forks to 5 and 8"],
      ["16->17", "crosses a public road"],
    ]);
    const CART_PATH_MAX_M = 400;

    let walked = 0;
    let ridden = 0;
    for (const [from, to] of [...Array(8).keys()].flatMap(
      (k) => [[k, k + 1], [k + 9, k + 10]] as [number, number][],
    )) {
      const d = dist(cupOf(from), teeOf(to));
      const key = `${from + 1}->${to + 1}`;
      const why = CART_PATHS.get(key);
      if (why === undefined) {
        expect(d, `${key} is walked (${why ?? "no cart path recorded"})`).toBeLessThan(TRANSITION_MAX_M);
        walked += 1;
      } else {
        // Still bounded, and still required to be long enough that calling it a ride is honest --
        // a "cart path" that turned out to be 40 m would mean the exception is no longer needed.
        expect(d, `${key} cart path: ${why}`).toBeGreaterThan(TRANSITION_MAX_M);
        expect(d, `${key} cart path: ${why}`).toBeLessThan(CART_PATH_MAX_M);
        ridden += 1;
      }
    }
    // Guard the guard: the counts pin how many exceptions exist, so a third long transition
    // appearing fails here instead of quietly joining the list.
    expect(walked).toBe(14);
    expect(ridden).toBe(2);
  });

  it("never leaves a cup inside another hole's water polygon", () => {
    /**
     * The half of the owner's "we cannot have a hole in the water" that the authored-data test
     * could not reach, and the half that matters: the routing this replaces put hole 17's cup
     * inside hole **9's** pond, so a check against each hole's own water missed it entirely.
     * `authoredCourse.test.ts` owns the own-hole half; this needs the placements to exist, so it
     * lives here.
     *
     * The cup is pushed into each other hole's local frame rather than the polygons being pulled
     * into the course frame -- same answer, and it reuses `toHoleFrame` instead of writing a
     * second transform that could disagree with it.
     */
    let pairsChecked = 0;
    const local = { x: 0, z: 0 };

    for (const hole of course.holes) {
      const cup = cupOf(hole.index);
      for (const other of course.holes) {
        // A cup inside its *own* water is `authoredCourse.test.ts`'s question, and for hole 13 the
        // answer is deliberately yes -- it is the island green, drawn solid with the green punched
        // back out of it.
        if (other.index === hole.index) continue;
        toHoleFrame(layout.placements[other.index]!, cup.x, cup.z, local);
        for (const poly of other.water) {
          expect(
            pointInPolygon(local.x, local.z, poly),
            `hole ${hole.index + 1} cup inside hole ${other.index + 1}'s water`,
          ).toBe(false);
          pairsChecked += 1;
        }
      }
    }

    // Guard the guard, twice over. An empty course, a course with no water, or a frame conversion
    // that lands every cup a kilometre from every pond all make the loop above vacuous.
    expect(pairsChecked).toBeGreaterThan(0);
    const wet = course.holes.filter((h) => h.water.length > 0);
    expect(wet.length).toBeGreaterThan(0);
    for (const hole of wet) {
      // The centroid of a water polygon is inside it, so round-tripping that point out to the
      // course frame and back must report true. If this went false the predicate above would be
      // always-false and could not fail on a real cup.
      const poly = hole.water[0]!;
      const cx = poly.points.reduce((a, p) => a + p.x, 0) / poly.points.length;
      const cz = poly.points.reduce((a, p) => a + p.z, 0) / poly.points.length;
      const out = inCourseFrame(hole.index, { x: cx, z: cz });
      toHoleFrame(layout.placements[hole.index]!, out.x, out.z, local);
      expect(
        pointInPolygon(local.x, local.z, poly),
        `hole ${hole.index + 1} water centroid survives the frame round trip`,
      ).toBe(true);
    }
  });
});
