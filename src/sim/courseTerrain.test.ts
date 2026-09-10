import { describe, expect, it } from "vitest";
import { COURSE_BLEND_M, COURSE_CELL_M, createCourseTerrain } from "./courseTerrain";
import type { PlacedHole } from "./courseTerrain";
import { fixedHoleSpec, generateCourse } from "./course";
import type { HoleSpec } from "./course";
import { BLEND_WIDTH, createTerrain, halfWidthAt } from "./terrain";
import { CART_MAX_SLOPE_CLIMB_DEG } from "./world";
import { solveCourseLayout, toCourseFrame, toHoleFrame } from "./courseLayout";
import type { HolePlacement, LayoutHole } from "./courseLayout";
import { mulberry32 } from "./rng";
import { createSpline } from "./spline";

/** The seed main.ts ships, as courseLayout.test.ts duplicates it and for the same reason. */
const COURSE_SEED = 2026;

/** Offset a long way from the origin and turned by something that is not a right angle, so a
 *  transform that dropped the rotation or the offset could not pass by accident. */
const PLACEMENT: HolePlacement = { index: 0, offsetX: 400, offsetZ: -250, rotation: 0.9 };

function placedFixture(placement: HolePlacement = PLACEMENT): {
  hole: PlacedHole;
  spec: HoleSpec;
} {
  const spec = fixedHoleSpec();
  const terrain = createTerrain(spec);
  return { hole: { placement, spec, terrain }, spec };
}

function courseOf(placement: HolePlacement, localX: number, localZ: number): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(placement, localX, localZ, out);
  return out;
}

describe("a hole's own ground, inside its own corridor", () => {
  it("is handed through unchanged at the tee and the cup", () => {
    const { hole, spec } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });

    for (const point of [spec.tee, spec.cup]) {
      const p = courseOf(hole.placement, point.x, point.z);
      expect(course.heightAt(p.x, p.z)).toBeCloseTo(hole.terrain.heightAt(point.x, point.z), 9);
    }
  });

  it("is not handed through out in the rough, which is where the course's own ground takes over", () => {
    // The positive control on the test above: if `heightAt` simply forwarded every query to the
    // nearest hole, that test would pass and this one would fail. The two fields are seeded
    // independently, so agreeing to 5 cm out here would be a coincidence rather than a design.
    const { hole, spec } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });

    const far = spec.fieldSize / 2 - 5;
    const p = courseOf(hole.placement, far, far);
    expect(course.heightAt(p.x, p.z)).not.toBeCloseTo(hole.terrain.heightAt(far, far), 2);
  });
});

describe("the rough between the holes", () => {
  it("is the same ground twice for the same seed, and different ground for a different one", () => {
    const { hole, spec } = placedFixture();
    const far = spec.fieldSize / 2 - 5;
    const p = courseOf(hole.placement, far, far);

    const a = createCourseTerrain([hole], { rough: mulberry32(7) }).heightAt(p.x, p.z);
    const b = createCourseTerrain([hole], { rough: mulberry32(7) }).heightAt(p.x, p.z);
    const other = createCourseTerrain([hole], { rough: mulberry32(8) }).heightAt(p.x, p.z);

    expect(a).toBe(b);
    expect(a).not.toBeCloseTo(other, 3);
  });
});

describe("influence", () => {
  it("is full out to the corridor's own blend band and gone a course blend beyond it", () => {
    const { hole, spec } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });
    const half = halfWidthAt(spec.corridor, 0.5);
    const centre = hole.terrain.spline.pointAt(0.5);

    // Straight out from the centreline, perpendicular in the hole's own frame.
    const tangent = { x: 0, z: 0 };
    hole.terrain.spline.tangentInto(0.5, tangent);
    const at = (lateral: number): number => {
      const p = courseOf(
        hole.placement,
        centre.x - tangent.z * lateral,
        centre.z + tangent.x * lateral,
      );
      return course.influenceAt(0, p.x, p.z);
    };
    /** What the corridor itself says the distance is. A curved centreline can be nearer to a
     *  point than the perpendicular offset from t=0.5 suggests, and the influence answers to the
     *  nearest point rather than to this test's idea of one. */
    const corridorDistance = (lateral: number): number =>
      hole.terrain.spline.nearest(centre.x - tangent.z * lateral, centre.z + tangent.x * lateral)
        .distance;

    expect(at(0)).toBe(1);
    expect(at(half)).toBe(1);
    expect(at(half + BLEND_WIDTH)).toBe(1);

    const gone = half + BLEND_WIDTH + COURSE_BLEND_M + 40;
    expect(corridorDistance(gone)).toBeGreaterThan(half + BLEND_WIDTH + COURSE_BLEND_M);
    expect(at(gone)).toBe(0);

    const middle = at(half + BLEND_WIDTH + COURSE_BLEND_M / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    // Monotone across the band, so the hole never comes *back* as you drive away from it.
    expect(at(half + BLEND_WIDTH + COURSE_BLEND_M * 0.25)).toBeGreaterThan(middle);
    expect(at(half + BLEND_WIDTH + COURSE_BLEND_M * 0.75)).toBeLessThan(middle);
  });
});

describe("the join between a hole and the course around it", () => {
  it("crosses a real gap without a step a cart could not drive", () => {
    const { hole, spec } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });
    const centre = hole.terrain.spline.pointAt(0.5);
    const tangent = { x: 0, z: 0 };
    hole.terrain.spline.tangentInto(0.5, tangent);
    const half = halfWidthAt(spec.corridor, 0.5);

    const lateralAt = (lateral: number): { x: number; z: number } =>
      courseOf(hole.placement, centre.x - tangent.z * lateral, centre.z + tangent.x * lateral);

    // The gap has to be real for the continuity below to mean anything: if the hole's ground and
    // the course's rough happened to agree at the join, any blend at all would look smooth.
    const joinLateral = half + BLEND_WIDTH;
    const join = lateralAt(joinLateral);
    const outside = lateralAt(joinLateral + COURSE_BLEND_M + 20);
    const holeSideGap = Math.abs(
      course.heightAt(outside.x, outside.z) -
        hole.terrain.heightAt(centre.x - tangent.z * (joinLateral + COURSE_BLEND_M + 20), centre.z + tangent.x * (joinLateral + COURSE_BLEND_M + 20)),
    );
    expect(holeSideGap).toBeGreaterThan(0.1);
    expect(course.heightAt(join.x, join.z)).toBeCloseTo(
      hole.terrain.heightAt(centre.x - tangent.z * joinLateral, centre.z + tangent.x * joinLateral),
      9,
    );

    // And now the step, sampled at the cell size across the whole band.
    const climb = Math.tan((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180) * COURSE_CELL_M;
    let worst = 0;
    let previous = course.heightAt(join.x, join.z);
    for (let d = joinLateral + COURSE_CELL_M; d < joinLateral + COURSE_BLEND_M + 40; d += COURSE_CELL_M) {
      const p = lateralAt(d);
      const here = course.heightAt(p.x, p.z);
      worst = Math.max(worst, Math.abs(here - previous));
      previous = here;
    }
    expect(worst).toBeLessThan(climb);
  });
});

describe("two holes over the same ground", () => {
  it("blends them together rather than stacking them", () => {
    // Two *different* holes laid on top of each other, crossing at right angles: an exaggerated
    // version of the clubhouse apron, where the layout lets corridors converge on purpose.
    const generated = generateCourse(COURSE_SEED, 2);
    const holes: PlacedHole[] = generated.holes.map((spec, i) => ({
      spec,
      terrain: createTerrain(spec),
      placement: { index: i, offsetX: 0, offsetZ: 0, rotation: (i * Math.PI) / 2 },
    }));
    const course = createCourseTerrain(holes, { rough: mulberry32(7) });

    // Both corridors run through the origin: each hole's routing is centred on its own.
    expect(course.influenceAt(0, 0, 0)).toBe(1);
    expect(course.influenceAt(1, 0, 0)).toBe(1);

    const own = holes.map((h) => h.terrain.heightAt(0, 0));
    const blended = course.heightAt(0, 0);

    // Both influences are 1, so the answer is their mean exactly. Asserted as the mean rather
    // than as "somewhere between the two": a sum of a negative height and a positive one lands
    // between them often enough that the looser assertion passes against stacking.
    expect(blended).toBeCloseTo((own[0]! + own[1]!) / 2, 9);
    expect(blended).toBeGreaterThanOrEqual(Math.min(...own) - 1e-9);
    expect(blended).toBeLessThanOrEqual(Math.max(...own) + 1e-9);
    // The control: the two holes disagree about this point, so a sum would land outside the pair
    // and these assertions would have something to catch.
    expect(Math.abs(own[0]! - own[1]!)).toBeGreaterThan(0.05);
  });
});

describe("a hazard out beyond the corridor", () => {
  it("keeps its own shape rather than being blended back into rough", () => {
    // A bunker or a pond is a placed thing with a floor. Fading one into the course rough leaves
    // a dish half dug -- and, for water, ground standing above the level the renderer draws the
    // surface at, which is a pond a cart drives across.
    const generated = generateCourse(COURSE_SEED, 18);
    const wide = generated.holes.find((h) => h.fieldSize === 300)!;
    const centre = createSpline(wide.control).pointAt(0.5);
    const tangent = { x: 0, z: 0 };
    createSpline(wide.control).tangentInto(0.5, tangent);
    // 80 m off the centreline: well past the corridor's own blend band and past the course blend
    // that follows it, so nothing but the bunker itself can hold this ground.
    const lateral = 80;
    const bunker = {
      x: centre.x - tangent.z * lateral,
      z: centre.z + tangent.x * lateral,
      radiusX: 9,
      radiusZ: 6,
      rotation: 0.4,
    };
    const spec: HoleSpec = { ...wide, bunkers: [...wide.bunkers, bunker] };
    const hole: PlacedHole = { placement: PLACEMENT, spec, terrain: createTerrain(spec) };
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });

    const p = courseOf(PLACEMENT, bunker.x, bunker.z);
    expect(course.influenceAt(0, p.x, p.z)).toBe(1);
    expect(course.heightAt(p.x, p.z)).toBeCloseTo(hole.terrain.heightAt(bunker.x, bunker.z), 9);

    // The control: ground the same distance out on the *other* side of the corridor, where there
    // is no bunker, is the course's rough and not this hole's at all.
    const empty = courseOf(PLACEMENT, centre.x + tangent.z * lateral, centre.z - tangent.x * lateral);
    expect(course.influenceAt(0, empty.x, empty.z)).toBe(0);
  });
});

describe("the heightfield", () => {
  it("is column-major with rows along Z and columns along X, as Rapier reads it", () => {
    const { hole } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7), cellM: 20 });
    const heights = course.buildHeightfield();

    expect(heights.length).toBe((course.rows + 1) * (course.cols + 1));

    const extentX = course.bounds.maxX - course.bounds.minX;
    const extentZ = course.bounds.maxZ - course.bounds.minZ;
    for (const [col, row] of [
      [0, 0],
      [1, 3],
      [course.cols, course.rows],
    ]) {
      const x = course.bounds.minX + (col! / course.cols) * extentX;
      const z = course.bounds.minZ + (row! / course.rows) * extentZ;
      expect(heights[row! + col! * (course.rows + 1)]).toBeCloseTo(course.heightAt(x, z), 5);
    }

    // The control on the indexing: reading it transposed gives a different answer, so an
    // implementation that filled the array row-major could not satisfy the loop above.
    const transposed = heights[3 + 1 * (course.rows + 1)] === heights[1 + 3 * (course.rows + 1)];
    expect(transposed).toBe(false);
  });

  it("covers every placed field", () => {
    const { hole, spec } = placedFixture();
    const course = createCourseTerrain([hole], { rough: mulberry32(7) });
    const half = spec.fieldSize / 2;
    for (const [lx, lz] of [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ]) {
      const p = courseOf(hole.placement, lx!, lz!);
      expect(p.x).toBeGreaterThanOrEqual(course.bounds.minX);
      expect(p.x).toBeLessThanOrEqual(course.bounds.maxX);
      expect(p.z).toBeGreaterThanOrEqual(course.bounds.minZ);
      expect(p.z).toBeLessThanOrEqual(course.bounds.maxZ);
    }
  });
});

describe("the course the game actually generates", () => {
  function realCourse() {
    const course = generateCourse(COURSE_SEED, 18);
    const layoutHoles: LayoutHole[] = course.holes.map((h) => ({
      index: h.index,
      tee: h.tee,
      cup: h.cup,
      control: h.control,
    }));
    const layout = solveCourseLayout(layoutHoles);
    const holes: PlacedHole[] = layout.placements.map((placement) => {
      const spec = course.holes[placement.index]!;
      return { placement, spec, terrain: createTerrain(spec) };
    });
    return { holes, terrain: createCourseTerrain(holes, { rough: mulberry32(COURSE_SEED) }) };
  }

  it("hands a corridor straight through wherever only its own hole reaches", () => {
    const { holes, terrain } = realCourse();
    let exclusive = 0;
    let shared = 0;
    for (const hole of holes) {
      for (let t = 0; t <= 1; t += 0.05) {
        const centre = hole.terrain.spline.pointAt(t);
        const p = courseOf(hole.placement, centre.x, centre.z);
        const others = holes.filter((_, i) => i !== holes.indexOf(hole));
        const reached = others.some((o) => terrain.influenceAt(holes.indexOf(o), p.x, p.z) > 0);
        if (reached) {
          shared++;
          continue;
        }
        exclusive++;
        expect(terrain.heightAt(p.x, p.z)).toBeCloseTo(hole.terrain.heightAt(centre.x, centre.z), 9);
      }
    }
    // Without this, a course where every sample was shared would pass the loop above by never
    // running its assertion at all.
    expect(exclusive).toBeGreaterThan(20);
    expect(shared).toBeGreaterThan(0);
  });

  it("never makes a corridor steeper than that hole already was on its own", () => {
    // The blend does move a corridor -- a green 30 m from the next tee sits inside that hole's
    // ground too, and the two average. What it must not do is *steepen* one: the height a cart
    // drives over may differ from stroke play's, but the slope it climbs may not be worse than
    // the slope the hole generator already signed off on for the same ground.
    const { holes, terrain } = realCourse();
    let worstCourse = 0;
    let worstOwn = 0;
    for (const hole of holes) {
      let previous: { course: number; own: number; x: number; z: number } | null = null;
      for (let t = 0; t <= 1; t += 0.002) {
        const centre = hole.terrain.spline.pointAt(t);
        const p = courseOf(hole.placement, centre.x, centre.z);
        const here = {
          course: terrain.heightAt(p.x, p.z),
          own: hole.terrain.heightAt(centre.x, centre.z),
          x: p.x,
          z: p.z,
        };
        if (previous !== null) {
          const run = Math.hypot(here.x - previous.x, here.z - previous.z);
          if (run > 0.05) {
            worstCourse = Math.max(worstCourse, Math.abs(here.course - previous.course) / run);
            worstOwn = Math.max(worstOwn, Math.abs(here.own - previous.own) / run);
          }
        }
        previous = here;
      }
    }
    // Both maxima land on the same causeway shoulder on hole 2, and the blend moves it by 3e-6.
    // Asserted as equal to the centimetre-per-metre rather than as an inequality, so this catches
    // a blend that flattened the course as well as one that steepened it.
    expect(worstCourse).toBeCloseTo(worstOwn, 2);
    // The control: those corridors have real steepness in them -- a causeway shoulder is the
    // steepest thing on the course -- so this is not two flat profiles agreeing with each other.
    expect(worstOwn).toBeGreaterThan(0.3);
  });

  it("never puts a tee or a cup outside the ground of the holes that meet there", () => {
    // Tees and cups are 30 m apart at a transition, so many of them sit where two corridors
    // overlap and the ground is a blend of both rather than either. What must hold is that the
    // blend stays *between* them: a spawn on ground higher or lower than every hole that made it
    // is a spawn in the air or under the map.
    const { holes, terrain } = realCourse();
    for (const hole of holes) {
      for (const point of [hole.spec.tee, hole.spec.cup]) {
        const p = courseOf(hole.placement, point.x, point.z);
        let low = Infinity;
        let high = -Infinity;
        for (let i = 0; i < holes.length; i++) {
          if (terrain.influenceAt(i, p.x, p.z) <= 0) continue;
          const other = holes[i]!;
          const local = { x: 0, z: 0 };
          toHoleFrame(other.placement, p.x, p.z, local);
          const h = other.terrain.heightAt(local.x, local.z);
          low = Math.min(low, h);
          high = Math.max(high, h);
        }
        expect(low).toBeLessThan(Infinity);
        expect(terrain.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(low - 1e-9);
        expect(terrain.heightAt(p.x, p.z)).toBeLessThanOrEqual(high + 1e-9);
      }
    }
  });

  it("is drivable everywhere along the eighteen corridors", () => {
    const { holes, terrain } = realCourse();
    const climb = Math.tan((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180) * COURSE_CELL_M;
    let worst = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    for (const hole of holes) {
      let previous: number | null = null;
      for (let t = 0; t <= 1; t += 0.002) {
        const centre = hole.terrain.spline.pointAt(t);
        const p = courseOf(hole.placement, centre.x, centre.z);
        const here = terrain.heightAt(p.x, p.z);
        if (previous !== null) worst = Math.max(worst, Math.abs(here - previous));
        previous = here;
        lowest = Math.min(lowest, here);
        highest = Math.max(highest, here);
      }
    }
    expect(worst).toBeLessThan(climb);
    // The control, and the reason this is not a test a flat world passes: there is real relief
    // along those corridors. "No step steeper than the climb limit" is free on a pancake.
    expect(highest - lowest).toBeGreaterThan(1);
  });
});
