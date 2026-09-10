import { describe, expect, it } from "vitest";
import { createCourseSurfaces } from "./courseSurfaces";
import { createCourseTerrain } from "./courseTerrain";
import type { PlacedHole } from "./courseTerrain";
import { generateCourse } from "./course";
import type { HoleSpec } from "./course";
import { createTerrain } from "./terrain";
import { createSurfaces, SURFACES, SurfaceId, createSurfaceTuning, createSurfaceWeights } from "./surfaces";
import type { Surfaces } from "./surfaces";
import { toCourseFrame } from "./courseLayout";
import type { HolePlacement } from "./courseLayout";
import { mulberry32 } from "./rng";
import { createSpline } from "./spline";

const COURSE_SEED = 2026;
const PLACEMENT: HolePlacement = { index: 0, offsetX: 400, offsetZ: -250, rotation: 0.9 };

/** One real hole, placed away from the origin and turned. A generated hole rather than the fixed
 *  one because these tests need a green, bunkers and -- for one of them -- water. */
function fixture(pick: (spec: HoleSpec) => boolean = () => true): {
  hole: PlacedHole;
  surfaces: Surfaces;
  course: ReturnType<typeof createCourseSurfaces>;
  terrain: ReturnType<typeof createCourseTerrain>;
} {
  const generated = generateCourse(COURSE_SEED, 18);
  const spec = generated.holes.find(pick)!;
  const holeTerrain = createTerrain(spec);
  const hole: PlacedHole = { placement: PLACEMENT, spec, terrain: holeTerrain };
  const surfaces = createSurfaces(spec, holeTerrain);
  const terrain = createCourseTerrain([hole], { rough: mulberry32(7) });
  return { hole, surfaces, course: createCourseSurfaces(terrain, [surfaces]), terrain };
}

function courseOf(placement: HolePlacement, x: number, z: number): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(placement, x, z, out);
  return out;
}

describe("classification", () => {
  it("gives a hole's own answer over its own ground", () => {
    const { hole, surfaces, course } = fixture();
    for (const point of [hole.spec.cup, hole.spec.tee]) {
      const p = courseOf(hole.placement, point.x, point.z);
      expect(course.surfaceAt(p.x, p.z)).toBe(surfaces.surfaceAt(point.x, point.z));
    }
    // The control: the cup is on a green, so the loop above is not comparing Rough with Rough.
    expect(surfaces.surfaceAt(hole.spec.cup.x, hole.spec.cup.z)).toBe(SurfaceId.Green);
  });

  it("answers to the hole that owns the point, not the first one that reaches it", () => {
    // Two holes crossing, with the *other* one listed first. A green under a neighbour's outfield
    // is still a green: the classification belongs to whichever hole holds the ground most, and
    // "the first hole with any influence here" is a different rule that agrees with it right up
    // until two holes overlap.
    const generated = generateCourse(COURSE_SEED, 18);
    const green = generated.holes[0]!;
    const neighbour = generated.holes[1]!;
    const holes: PlacedHole[] = [
      { placement: { index: 1, offsetX: 0, offsetZ: 0, rotation: Math.PI / 2 }, spec: neighbour, terrain: createTerrain(neighbour) },
      { placement: { index: 0, offsetX: 0, offsetZ: 0, rotation: 0 }, spec: green, terrain: createTerrain(green) },
    ];
    const terrain = createCourseTerrain(holes, { rough: mulberry32(7) });
    const perHole = holes.map((h) => createSurfaces(h.spec, h.terrain));
    const course = createCourseSurfaces(terrain, perHole);

    // Somewhere on the green where the neighbour reaches but holds less.
    let tested = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = green.cup.x + Math.cos(angle) * green.green.radiusX * 0.5;
      const z = green.cup.z + Math.sin(angle) * green.green.radiusZ * 0.5;
      const mine = terrain.influenceAt(1, x, z);
      const theirs = terrain.influenceAt(0, x, z);
      if (mine <= theirs || theirs <= 0) continue;
      if (perHole[1]!.surfaceAt(x, z) !== SurfaceId.Green) continue;
      if (perHole[0]!.surfaceAt(x, z) === SurfaceId.Green) continue;
      tested++;
      expect(course.surfaceAt(x, z)).toBe(SurfaceId.Green);
    }
    expect(tested).toBeGreaterThan(0);
  });

  it("is rough wherever no hole reaches", () => {
    const { hole, course, terrain } = fixture();
    const far = hole.spec.fieldSize / 2 + 30;
    const p = courseOf(hole.placement, far, far);
    expect(terrain.influenceAt(0, p.x, p.z)).toBe(0);
    expect(course.surfaceAt(p.x, p.z)).toBe(SurfaceId.Rough);
  });
});

describe("tuning", () => {
  it("is the hole's own on the green and the rough table out beyond it", () => {
    const { hole, surfaces, course } = fixture();
    const out = createSurfaceTuning();
    const own = createSurfaceTuning();

    const cup = courseOf(hole.placement, hole.spec.cup.x, hole.spec.cup.z);
    course.tuningAt(cup.x, cup.z, out);
    surfaces.tuningAt(hole.spec.cup.x, hole.spec.cup.z, own);
    expect(out.rolling).toBeCloseTo(own.rolling, 9);
    // The control: a green rolls very differently from rough, so that is a real comparison.
    expect(own.rolling).toBeLessThan(SURFACES[SurfaceId.Rough].rolling);

    const far = hole.spec.fieldSize / 2 + 30;
    const p = courseOf(hole.placement, far, far);
    course.tuningAt(p.x, p.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Rough].rolling, 9);
    expect(out.cartSpeedScale).toBeCloseTo(SURFACES[SurfaceId.Rough].cartSpeedScale, 9);
    expect(out.isHazard).toBe(false);
  });

  it("crosses the join no more abruptly than the hole does on its own", () => {
    const { hole, surfaces, course } = fixture();
    const spline = createSpline(hole.spec.control);
    const centre = spline.pointAt(0.5);
    const tangent = { x: 0, z: 0 };
    spline.tangentInto(0.5, tangent);
    const out = createSurfaceTuning();
    const own = createSurfaceTuning();

    let worstCourse = 0;
    let worstOwn = 0;
    let previousCourse: number | null = null;
    let previousOwn: number | null = null;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let lateral = 0; lateral < 140; lateral += 2) {
      const localX = centre.x - tangent.z * lateral;
      const localZ = centre.z + tangent.x * lateral;
      const p = courseOf(hole.placement, localX, localZ);
      course.tuningAt(p.x, p.z, out);
      surfaces.tuningAt(localX, localZ, own);
      if (previousCourse !== null) {
        worstCourse = Math.max(worstCourse, Math.abs(out.cartSpeedScale - previousCourse));
      }
      if (previousOwn !== null) {
        worstOwn = Math.max(worstOwn, Math.abs(own.cartSpeedScale - previousOwn));
      }
      previousCourse = out.cartSpeedScale;
      previousOwn = own.cartSpeedScale;
      lowest = Math.min(lowest, out.cartSpeedScale);
      highest = Math.max(highest, out.cartSpeedScale);
    }
    // The steps that remain are the hole's own -- a bunker lip is a hard edge in `tuningAt` by
    // design. What the assembly may not do is add one of its own at the join.
    expect(worstCourse).toBeLessThanOrEqual(worstOwn + 1e-9);
    // Two controls: the traverse really crosses from mown ground to rough, and the hole's own
    // profile really does step somewhere, so neither side of the comparison is a flat line.
    expect(highest - lowest).toBeGreaterThan(0.2);
    expect(worstOwn).toBeGreaterThan(0.02);
  });
});

describe("weights", () => {
  it("keeps sand hard-edged, and the corridor falloff continuous", () => {
    const { hole, surfaces, course } = fixture((s) => s.bunkers.length > 0);
    const bunker = hole.spec.bunkers[0]!;
    const out = createSurfaceWeights();
    const own = createSurfaceWeights();

    const p = courseOf(hole.placement, bunker.x, bunker.z);
    course.weightsAt(p.x, p.z, out);
    surfaces.weightsAt(bunker.x, bunker.z, own);
    expect(out.sand).toBe(1);
    expect(own.sand).toBe(1);
    expect(out.corridor).toBeCloseTo(own.corridor, 9);

    // Just outside the same bunker: sand is gone entirely rather than fading.
    const outside = courseOf(
      hole.placement,
      bunker.x + bunker.radiusX * 2 + 4,
      bunker.z + bunker.radiusZ * 2 + 4,
    );
    course.weightsAt(outside.x, outside.z, out);
    expect(out.sand).toBe(0);
  });

  it("is full rough weights where no hole reaches", () => {
    const { hole, course, terrain } = fixture();
    const far = hole.spec.fieldSize / 2 + 30;
    const p = courseOf(hole.placement, far, far);
    expect(terrain.influenceAt(0, p.x, p.z)).toBe(0);

    const out = createSurfaceWeights();
    course.weightsAt(p.x, p.z, out);
    expect(out).toEqual({ green: 1, corridor: 1, sand: 0, water: 0, bridge: 0 });
  });
});

describe("water", () => {
  it("is still water out where the corridor has let go of the ground", () => {
    const { hole, surfaces, course } = fixture((s) => s.water.length > 0);
    // The pond's own vertices, which is ground the hole shaped and the course must not un-shape.
    const poly = hole.spec.water[0]!;
    let found = 0;
    for (const point of poly.points) {
      if (surfaces.surfaceAt(point.x, point.z) !== SurfaceId.Water) continue;
      found++;
      const p = courseOf(hole.placement, point.x, point.z);
      expect(course.surfaceAt(p.x, p.z)).toBe(SurfaceId.Water);
    }
    expect(found).toBeGreaterThan(0);
  });
});
