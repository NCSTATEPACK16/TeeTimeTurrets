import { describe, expect, it } from "vitest";
import {
  CLUBHOUSE_GAP_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MIN_M,
  TRANSITION_MAX_M,
  inspectLayout,
  loopRadius,
  solveCourseLayout,
  toCourseFrame,
  toHoleFrame,
} from "./courseLayout";
import type { CourseLayout, LayoutHole } from "./courseLayout";
import { generateCourse } from "./course";

/** The seed main.ts ships (main.ts:32). Duplicated rather than imported: main.ts pulls in three
 *  and the DOM, and this suite runs in the node environment. */
const COURSE_SEED = 2026;

/**
 * The layout is a construction rather than a search, so these assert the properties it is
 * supposed to guarantee -- the loop closes, the walk between holes is short, corridors keep
 * clear -- rather than the coordinates it happens to produce. A test that pinned the numbers
 * would fail on any change to the hole generator and prove nothing about the shape.
 */

/** A hole `length` metres long, running down local +X from the origin. */
function hole(index: number, length: number): LayoutHole {
  return {
    index,
    tee: { x: -length / 2, z: 0 },
    cup: { x: length / 2, z: 0 },
    control: [
      { x: -length / 2, z: 0 },
      { x: 0, z: 0 },
      { x: length / 2, z: 0 },
    ],
  };
}

/** Eighteen holes of plausible lengths: par 3s short, par 5s long. */
function eighteen(): LayoutHole[] {
  const pars = [4, 3, 4, 5, 4, 3, 4, 4, 5, 4, 5, 4, 3, 4, 4, 3, 4, 5];
  const lengthFor: Record<number, number> = { 3: 82, 4: 216, 5: 313 };
  return pars.map((par, i) => hole(i, lengthFor[par]!));
}

function place(layout: CourseLayout, index: number, local: { x: number; z: number }): { x: number; z: number } {
  const p = layout.placements.find((q) => q.index === index)!;
  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);
  return {
    x: p.offsetX + local.x * cos - local.z * sin,
    z: p.offsetZ + local.x * sin + local.z * cos,
  };
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe("transition slack bounds", () => {
  it("brackets the shipped target", () => {
    expect(TRANSITION_MIN_M).toBeLessThan(TRANSITION_M);
    expect(TRANSITION_MAX_M).toBeGreaterThan(TRANSITION_M);
  });
});

describe("loopRadius", () => {
  it("returns the radius whose chords subtend exactly a full turn", () => {
    const chords = [100, 150, 220, 80, 313];
    const r = loopRadius(chords);
    const total = chords.reduce((sum, c) => sum + 2 * Math.asin(c / (2 * r)), 0);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
  });

  it("grows with the perimeter it has to carry", () => {
    const small = loopRadius([100, 100, 100, 100]);
    const big = loopRadius([200, 200, 200, 200]);
    expect(big).toBeGreaterThan(small);
    // Doubling every chord doubles the circle.
    expect(big).toBeCloseTo(small * 2, 6);
  });

  it("gives a square's circumcircle for four equal chords", () => {
    // Four equal chords closing a loop is a square; its circumradius is side / sqrt(2).
    expect(loopRadius([100, 100, 100, 100])).toBeCloseTo(100 / Math.SQRT2, 6);
  });

  it("keeps every chord inside the circle it fits", () => {
    const chords = [313, 82, 216, 216, 100];
    const r = loopRadius(chords);
    expect(r * 2).toBeGreaterThanOrEqual(Math.max(...chords));
  });
});

describe("returning nines", () => {
  const holes = eighteen();
  const layout = solveCourseLayout(holes);

  it("places every hole exactly once", () => {
    expect(layout.placements).toHaveLength(18);
    expect(new Set(layout.placements.map((p) => p.index)).size).toBe(18);
  });

  it("tees hole 1 off at the clubhouse", () => {
    expect(dist(place(layout, 0, holes[0]!.tee), layout.clubhouse)).toBeLessThan(1);
  });

  it("brings hole 9 back to the clubhouse", () => {
    // The loop closes to within the walk it leaves between a green and the next tee.
    expect(dist(place(layout, 8, holes[8]!.cup), layout.clubhouse)).toBeLessThanOrEqual(TRANSITION_M + 1);
  });

  it("tees hole 10 off beside the clubhouse, not on top of hole 1", () => {
    const first = place(layout, 0, holes[0]!.tee);
    const tenth = place(layout, 9, holes[9]!.tee);
    expect(dist(tenth, layout.clubhouse)).toBeLessThanOrEqual(CLUBHOUSE_GAP_M + 1);
    expect(dist(first, tenth)).toBeCloseTo(CLUBHOUSE_GAP_M, 3);
  });

  it("brings hole 18 back to the clubhouse", () => {
    expect(dist(place(layout, 17, holes[17]!.cup), layout.clubhouse)).toBeLessThanOrEqual(
      CLUBHOUSE_GAP_M + TRANSITION_M + 1,
    );
  });

  it("keeps the walk from each green to the next tee within the slack bounds", () => {
    for (const [from, to] of [...pairsWithin(0, 8), ...pairsWithin(9, 17)]) {
      const green = place(layout, from, holes[from]!.cup);
      const tee = place(layout, to, holes[to]!.tee);
      expect(dist(green, tee)).toBeGreaterThanOrEqual(TRANSITION_MIN_M - 0.5);
      expect(dist(green, tee)).toBeLessThanOrEqual(TRANSITION_MAX_M + 0.5);
    }
  });

  it("puts the two nines on opposite sides of the clubhouse", () => {
    // Every front-nine hole should sit one side of the clubhouse line and every back-nine hole
    // the other; a layout that interleaved them would be two loops in the same field.
    const side = (i: number): number => Math.sign(place(layout, i, holes[i]!.cup).z - layout.clubhouse.z);
    const front = [1, 2, 3, 4, 5, 6, 7].map(side);
    const back = [10, 11, 12, 13, 14, 15, 16].map(side);
    expect(new Set(front).size).toBe(1);
    expect(new Set(back).size).toBe(1);
    expect(front[0]).not.toBe(back[0]);
  });

  it("does not move, stretch or mirror a hole", () => {
    // Placement is a rigid motion: the tee-to-cup distance must survive it exactly, or the
    // terrain that gets carved later is a different hole from the one that was generated.
    for (const h of holes) {
      const local = dist(h.tee, h.cup);
      const placed = dist(place(layout, h.index, h.tee), place(layout, h.index, h.cup));
      expect(placed).toBeCloseTo(local, 6);
    }
  });

  it("is deterministic", () => {
    const a = solveCourseLayout(eighteen());
    expect(a).toEqual(solveCourseLayout(eighteen()));
    // Paired with a substance check, or two empty results would satisfy this.
    expect(a.placements).toHaveLength(18);
  });
});

function pairsWithin(first: number, last: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = first; i < last; i++) out.push([i, i + 1]);
  return out;
}

describe("inspectLayout", () => {
  it("reports a clean bill for the layout it is given", () => {
    const holes = eighteen();
    const report = inspectLayout(holes, solveCourseLayout(holes));
    expect(report.maxTransitionM).toBeLessThanOrEqual(TRANSITION_MAX_M + 0.5);
    expect(report.frontReturnM).toBeLessThanOrEqual(TRANSITION_M + 1);
    expect(report.conflicts).toEqual([]);
  });

  it("notices corridors that run into each other", () => {
    // Two holes forced onto the same ground: the report has to say so, or it is decoration.
    const holes = eighteen();
    const layout = solveCourseLayout(holes);
    // Hole 6 dropped exactly on hole 4. Both sit mid-nine, well away from the clubhouse apron
    // where holes are allowed to converge, so this cannot be excused by that exemption.
    const onto = layout.placements.find((p) => p.index === 3)!;
    const collided: CourseLayout = {
      clubhouse: layout.clubhouse,
      placements: layout.placements.map((p) =>
        p.index === 5 ? { ...p, offsetX: onto.offsetX, offsetZ: onto.offsetZ, rotation: onto.rotation } : p,
      ),
    };
    const report = inspectLayout(holes, collided);
    expect(report.conflicts.length).toBeGreaterThan(0);
    expect(report.minClearanceM).toBeLessThan(CORRIDOR_CLEARANCE_M);
  });
});

describe("the course the game actually generates", () => {
  it("lays out all eighteen real holes with no corridor conflict", () => {
    const course = generateCourse(COURSE_SEED, 18);
    const holes: LayoutHole[] = course.holes.map((h) => ({
      index: h.index,
      tee: h.tee,
      cup: h.cup,
      control: h.control,
    }));
    const report = inspectLayout(holes, solveCourseLayout(holes));
    expect(report.conflicts).toEqual([]);
    expect(report.minClearanceM).toBeGreaterThanOrEqual(CORRIDOR_CLEARANCE_M);
  });
});

describe("toHoleFrame", () => {
  /** Offset, and turned by something that is not a multiple of a quarter turn: at 90 degrees a
   *  sign error in the inverse rotation is invisible, because sin and cos swap cleanly. */
  const frame = { offsetX: 320, offsetZ: -140, rotation: 0.7 };

  it("undoes toCourseFrame", () => {
    const course = { x: 0, z: 0 };
    const back = { x: 0, z: 0 };
    toCourseFrame(frame, 37, -19, course);
    toHoleFrame(frame, course.x, course.z, back);
    expect(back.x).toBeCloseTo(37, 9);
    expect(back.z).toBeCloseTo(-19, 9);
  });

  it("puts the frame's own offset at the hole's origin", () => {
    const out = { x: 0, z: 0 };
    toHoleFrame(frame, frame.offsetX, frame.offsetZ, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(0, 9);
    // The positive control: a point that is not the offset does not land on the origin, so this
    // cannot pass on an implementation that returns zero.
    toHoleFrame(frame, frame.offsetX + 25, frame.offsetZ, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(25, 9);
  });

  it("rotates the opposite way from toCourseFrame", () => {
    // A quarter turn sends local +X to course +Z, so reading course +Z must give back local +X.
    // Rotating the same way instead would answer local -X.
    const out = { x: 0, z: 0 };
    toHoleFrame({ offsetX: 0, offsetZ: 0, rotation: Math.PI / 2 }, 0, 10, out);
    expect(out.x).toBeCloseTo(10, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });

  it("is a rigid motion: it moves points without stretching the distances between them", () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    toHoleFrame(frame, 100, 60, a);
    toHoleFrame(frame, 130, 20, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(Math.hypot(100 - 130, 60 - 20), 9);
  });
});

/** Course-frame bearing of a hole's tee-to-cup line, radians. */
function bearing(layout: CourseLayout, holes: readonly LayoutHole[], index: number): number {
  const h = holes[index]!;
  const tee = place(layout, index, h.tee);
  const cup = place(layout, index, h.cup);
  return Math.atan2(cup.z - tee.z, cup.x - tee.x);
}

/** Course-frame midpoint of a hole's tee-to-cup line. */
function midpoint(
  layout: CourseLayout,
  holes: readonly LayoutHole[],
  index: number,
): { x: number; z: number } {
  const h = holes[index]!;
  const tee = place(layout, index, h.tee);
  const cup = place(layout, index, h.cup);
  return { x: (tee.x + cup.x) / 2, z: (tee.z + cup.z) / 2 };
}

/** Smallest angle between two bearings, 0..PI. */
function angleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * The routing reads as a real course rather than a ring of holes, which is a shape claim and so
 * needs a measurable stand-in. This is it: a real routing sends holes **out and back beside each
 * other** -- Pinehurst No. 2's 1 and 18, its 12/13/14 -- so somewhere in each nine there are
 * pairs of holes pointing opposite ways with only a tree belt between them.
 *
 * Both halves of the condition carry weight, and the circular layout is exactly why. On a circle
 * two holes a third of the way apart *are* near-anti-parallel -- they are on opposite sides of
 * the ring -- and they are also two radii apart, which is 600 m of other holes. Anti-parallel
 * alone would pass against the shape this test exists to reject.
 */
describe("holes run out and back beside each other", () => {
  /** How far from a straight reversal a pair may be and still count as a returning leg. */
  const OPPOSED_TOLERANCE = (30 * Math.PI) / 180;
  /** Close enough to share a lobe. Wider than CORRIDOR_CLEARANCE_M, which is the floor, not this. */
  const NEIGHBOUR_M = 150;

  function pairedLegs(
    layout: CourseLayout,
    holes: readonly LayoutHole[],
    from: number,
    to: number,
  ): number {
    let count = 0;
    for (let i = from; i < to; i++) {
      for (let j = i + 1; j < to; j++) {
        const offBy = Math.PI - angleBetween(bearing(layout, holes, i), bearing(layout, holes, j));
        if (offBy > OPPOSED_TOLERANCE) continue;
        if (dist(midpoint(layout, holes, i), midpoint(layout, holes, j)) > NEIGHBOUR_M) continue;
        count++;
      }
    }
    return count;
  }

  it("pairs holes into returning legs on the front nine", () => {
    const holes = eighteen();
    expect(pairedLegs(solveCourseLayout(holes), holes, 0, 9)).toBeGreaterThanOrEqual(2);
  });

  it("pairs holes into returning legs on the back nine", () => {
    const holes = eighteen();
    expect(pairedLegs(solveCourseLayout(holes), holes, 9, 18)).toBeGreaterThanOrEqual(2);
  });

  it("does the same on the course the game actually generates", () => {
    const course = generateCourse(COURSE_SEED, 18);
    const holes: LayoutHole[] = course.holes.map((h) => ({
      index: h.index,
      tee: h.tee,
      cup: h.cup,
      control: h.control,
    }));
    const layout = solveCourseLayout(holes);
    expect(pairedLegs(layout, holes, 0, 9)).toBeGreaterThanOrEqual(2);
    expect(pairedLegs(layout, holes, 9, 18)).toBeGreaterThanOrEqual(2);
  });
});
