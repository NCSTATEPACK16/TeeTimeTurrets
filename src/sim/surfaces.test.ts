import { describe, expect, it } from "vitest";
import { biomeForIndex, defaultGreen, fixedHoleSpec, stripeAngleFor } from "./course";
import type { HoleSpec, Vec2 } from "./course";
import { pointInEllipse } from "./hazards";
import type { Ellipse, Polygon } from "./hazards";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import {
  SURFACES,
  SurfaceId,
  createSurfaceTuning,
  createSurfaceWeights,
  createSurfaces,
} from "./surfaces";
import { DECK_HALF_WIDTH, DECK_SHOULDER_RUN, deriveCrossings } from "./crossing";

const SPEC = fixedHoleSpec();
const terrain = createTerrain(SPEC);
const surfaces = createSurfaces(SPEC, terrain);

/**
 * The fixture plus one bunker and one pond.
 *
 * `fixedHoleSpec()` is deliberately hazard-free since Tier 2 -- water and sand are placed now, and
 * the fixture is what the cart and ballistics suites run against, so it stays clean. Any test
 * whose subject *is* sand or water needs a hole that has some, and this is it.
 *
 * Both sit clear of the mown line: the fixture runs tee (-45, 0) to cup (45, 8) with its dog-leg
 * apex at (0, -25), so the +Z half of the field is open ground.
 */
const HAZARD_SPEC: HoleSpec = {
  ...SPEC,
  bunkers: [{ x: -10, z: 34, radiusX: 10, radiusZ: 6, rotation: 0.3 }],
  water: [
    {
      points: [
        { x: 10, z: 25 },
        { x: 40, z: 25 },
        { x: 40, z: 55 },
        { x: 10, z: 55 },
      ],
    },
  ],
};
const hazardTerrain = createTerrain(HAZARD_SPEC);
const hazardSurfaces = createSurfaces(HAZARD_SPEC, hazardTerrain);

/** A point `offset` metres to the left of the centreline at parameter t. */
function acrossCorridor(t: number, offset: number): { x: number; z: number } {
  const centre = terrain.spline.pointAt(t);
  const tangent = { x: 0, z: 0 };
  terrain.spline.tangentInto(t, tangent);
  return { x: centre.x - tangent.z * offset, z: centre.z + tangent.x * offset };
}

describe("tuningAt", () => {
  it("writes into the caller's object rather than returning a new one", () => {
    const out = createSurfaceTuning();
    const centre = terrain.spline.pointAt(0.5);
    surfaces.tuningAt(centre.x, centre.z, out);
    const first = out.rolling;

    const far = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH + 20);
    surfaces.tuningAt(far.x, far.z, out);
    expect(out.rolling).not.toBe(first);
  });

  it("matches SURFACES exactly on the mown corridor and in full rough", () => {
    // t=0.8 rather than 0.5: the dog-leg apex around t=0.5 carries a bunker and enough
    // curvature that a tangent-offset probe point drifts from the spline's true nearest
    // distance. t=0.8 runs straight, so the probe offsets line up with the real corridor width.
    const out = createSurfaceTuning();

    const centre = acrossCorridor(0.8, 0);
    surfaces.tuningAt(centre.x, centre.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Fairway].rolling, 9);
    expect(out.bounceScale).toBeCloseTo(SURFACES[SurfaceId.Fairway].bounceScale, 9);

    const rough = acrossCorridor(0.8, HALF_WIDTH + BLEND_WIDTH + 3);
    surfaces.tuningAt(rough.x, rough.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Rough].rolling, 9);
  });

  it("is monotone across the fairway-to-rough band", () => {
    // See above: t=0.8 keeps the probe's offset distance faithful to the spline's actual
    // nearest distance, which t=0.5's curvature near the dog-leg apex does not.
    const out = createSurfaceTuning();
    let previous = -Infinity;
    for (let d = HALF_WIDTH - 2; d <= HALF_WIDTH + BLEND_WIDTH + 2; d += 0.5) {
      const p = acrossCorridor(0.8, d);
      // Skip cells the discrete classifier calls sand or water: those keep hard edges.
      const id = surfaces.surfaceAt(p.x, p.z);
      if (id === SurfaceId.Sand || id === SurfaceId.Water) continue;
      surfaces.tuningAt(p.x, p.z, out);
      expect(out.rolling).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = out.rolling;
    }
    expect(previous).toBeCloseTo(SURFACES[SurfaceId.Rough].rolling, 6);
  });

  it("reaches the green's rolling resistance at the cup", () => {
    const out = createSurfaceTuning();
    surfaces.tuningAt(SPEC.cup.x, SPEC.cup.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Green].rolling, 9);
  });

  it("takes no intermediate step larger than a tick's worth of acceleration change", () => {
    // The shipped defect: crr jumped 0.11 -> 0.22 in one tick at the fairway edge. Assert the
    // largest single-metre change is a small fraction of that.
    const out = createSurfaceTuning();
    let worst = 0;
    let previous: number | null = null;
    for (let d = 0; d <= HALF_WIDTH + BLEND_WIDTH + 10; d += 0.25) {
      const p = acrossCorridor(0.35, d);
      const id = surfaces.surfaceAt(p.x, p.z);
      if (id === SurfaceId.Sand || id === SurfaceId.Water) {
        previous = null;
        continue;
      }
      surfaces.tuningAt(p.x, p.z, out);
      if (previous !== null) worst = Math.max(worst, Math.abs(out.rolling - previous));
      previous = out.rolling;
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("keeps sand and water hard-edged", () => {
    // A bunker lip and a water margin are supposed to be abrupt: blending them would make a
    // ball drift to a halt in a bunker rather than stop in it.
    const out = createSurfaceTuning();
    let sampled = false;
    for (let x = -78; x <= 78 && !sampled; x += 1) {
      for (let z = -78; z <= 78; z += 1) {
        if (hazardSurfaces.surfaceAt(x, z) !== SurfaceId.Sand) continue;
        hazardSurfaces.tuningAt(x, z, out);
        expect(out.rolling).toBe(SURFACES[SurfaceId.Sand].rolling);
        expect(out.bounceScale).toBe(SURFACES[SurfaceId.Sand].bounceScale);
        sampled = true;
        break;
      }
    }
    expect(sampled).toBe(true);
  });

  it("flags water as a hazard and nothing else", () => {
    const out = createSurfaceTuning();
    const centre = terrain.spline.pointAt(0.5);
    surfaces.tuningAt(centre.x, centre.z, out);
    expect(out.isHazard).toBe(false);
  });
});

describe("surfaceAt", () => {
  it("calls the corridor fairway out to the middle of the blend band", () => {
    const inside = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH / 2 - 1);
    const outside = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH / 2 + 1);
    // Sand can win over either, so only assert when the classifier is not calling it sand.
    if (surfaces.surfaceAt(inside.x, inside.z) !== SurfaceId.Sand) {
      expect(surfaces.surfaceAt(inside.x, inside.z)).toBe(SurfaceId.Fairway);
    }
    if (surfaces.surfaceAt(outside.x, outside.z) !== SurfaceId.Sand) {
      expect(surfaces.surfaceAt(outside.x, outside.z)).toBe(SurfaceId.Rough);
    }
  });

  it("follows the dog-leg rather than the straight tee-to-cup line", () => {
    // A point beside the apex is on the corridor; the same distance off the straight line is not.
    const apex = SPEC.control[1];
    expect(surfaces.surfaceAt(apex.x, apex.z)).not.toBe(SurfaceId.Rough);
  });

  it("calls the cup's neighbourhood green", () => {
    expect(surfaces.surfaceAt(SPEC.cup.x, SPEC.cup.z)).toBe(SurfaceId.Green);
    expect(surfaces.surfaceAt(SPEC.cup.x + GREEN_RADIUS - 1, SPEC.cup.z)).toBe(SurfaceId.Green);
  });
});

/**
 * A HoleSpec distinct from fixedHoleSpec() in every field that feeds sandChannel or the
 * fairway corridor, so this exercises createSurfaces' default (non-fixed-source) code path
 * rather than accidentally retracing the fixture's numbers.
 */
function nonLegacySpec(): HoleSpec {
  const tee: Vec2 = { x: -40, z: 12 };
  const cup: Vec2 = { x: 30, z: -18 };
  return {
    seed: 0x1234abcd,
    index: 2,
    fieldSize: 160,
    cells: 160,
    tee,
    cup,
    control: [tee, { x: (tee.x + cup.x) / 2, z: (tee.z + cup.z) / 2 }, cup],
    par: 4,
    waterLevel: -0.72,
    water: [],
    bunkers: [],
    green: defaultGreen(cup),
    corridor: [HALF_WIDTH, HALF_WIDTH, HALF_WIDTH],
    biome: biomeForIndex(2),
    stripeAngle: stripeAngleFor(0x1234abcd, 2, tee, cup),
  };
}

const AXIS: readonly number[] = [-60, -35, -10, 15, 40, 60];

describe("createSurfaces default sand source (no sources override)", () => {
  it("classifies deterministically for a fixed seed", () => {
    const spec = nonLegacySpec();
    const nonLegacyTerrain = createTerrain(spec);
    const a = createSurfaces(spec, nonLegacyTerrain);
    const b = createSurfaces(spec, nonLegacyTerrain);

    for (const x of AXIS) {
      for (const z of AXIS) {
        expect(() => a.surfaceAt(x, z)).not.toThrow();
        expect(b.surfaceAt(x, z)).toBe(a.surfaceAt(x, z));
      }
    }
  });

  // Removed with Tier 2: "draws sand noise from mulberry32(sandChannel(spec)), not a fixed
  // constant source". `createSurfaces` no longer samples a noise field for sand and no longer
  // takes a `SurfaceSources` override, so there is no injected source left to assert about.
  // `sandChannel` survives and is now what bunker *placement* draws from; the equivalent
  // assertion -- that placement is seeded rather than fixed -- lives in course.test.ts.
});

describe("weightsAt", () => {
  it("writes into the caller's object rather than returning a new one", () => {
    const out = createSurfaceWeights();
    const centre = acrossCorridor(0.8, 0);
    surfaces.weightsAt(centre.x, centre.z, out);
    const first = out.corridor;

    const far = acrossCorridor(0.8, HALF_WIDTH + BLEND_WIDTH + 20);
    surfaces.weightsAt(far.x, far.z, out);
    expect(out.corridor).not.toBe(first);
  });

  it("reads 0 on the mown corridor and 1 in full rough", () => {
    const out = createSurfaceWeights();

    surfaces.weightsAt(acrossCorridor(0.8, 0).x, acrossCorridor(0.8, 0).z, out);
    expect(out.corridor).toBeCloseTo(0, 9);

    const far = acrossCorridor(0.8, HALF_WIDTH + BLEND_WIDTH + 20);
    surfaces.weightsAt(far.x, far.z, out);
    expect(out.corridor).toBeCloseTo(1, 9);
  });

  it("reads 0 for green at the cup and 1 well off it", () => {
    const out = createSurfaceWeights();

    surfaces.weightsAt(SPEC.cup.x, SPEC.cup.z, out);
    expect(out.green).toBeCloseTo(0, 9);

    surfaces.weightsAt(SPEC.cup.x + GREEN_RADIUS + 40, SPEC.cup.z, out);
    expect(out.green).toBeCloseTo(1, 9);
  });

  it("agrees with tuningAt: the same weights reproduce its blended rolling value", () => {
    // The point of exporting weights is that the renderer can colour the ground from exactly
    // what the physics blends with. If these two ever diverge, the visible corridor edge and
    // the physical one have drifted apart -- which is the bug this test exists to catch.
    const weights = createSurfaceWeights();
    const tuning = createSurfaceTuning();
    const green = SURFACES[SurfaceId.Green];
    const fairway = SURFACES[SurfaceId.Fairway];
    const rough = SURFACES[SurfaceId.Rough];

    for (let t = 0.05; t < 1; t += 0.05) {
      for (const offset of [0, 6, 12, 18, 24, 30]) {
        const p = acrossCorridor(t, offset);
        const id = surfaces.surfaceAt(p.x, p.z);
        if (id === SurfaceId.Sand || id === SurfaceId.Water) continue;

        surfaces.weightsAt(p.x, p.z, weights);
        surfaces.tuningAt(p.x, p.z, tuning);

        const mown = green.rolling + (fairway.rolling - green.rolling) * weights.green;
        const expected = mown + (rough.rolling - mown) * weights.corridor;
        expect(tuning.rolling).toBeCloseTo(expected, 9);
      }
    }
  });

  it("flags sand and water as 1 exactly where surfaceAt calls them", () => {
    // Runs against the hazard fixture rather than the bare one. Since Tier 2 `fixedHoleSpec()`
    // has neither sand nor water, so the `sandSeen`/`waterSeen` guards below -- which exist to
    // stop this test passing vacuously -- would otherwise be unsatisfiable.
    const out = createSurfaceWeights();
    const size = HAZARD_SPEC.fieldSize;
    let sandSeen = 0;
    let waterSeen = 0;

    for (let x = -size / 2; x < size / 2; x += 3.1) {
      for (let z = -size / 2; z < size / 2; z += 3.1) {
        hazardSurfaces.weightsAt(x, z, out);
        const id = hazardSurfaces.surfaceAt(x, z);
        expect(out.sand).toBe(id === SurfaceId.Sand ? 1 : 0);
        expect(out.water).toBe(id === SurfaceId.Water ? 1 : 0);
        if (out.sand === 1) sandSeen++;
        if (out.water === 1) waterSeen++;
      }
    }
    // Guard against the assertions above passing because the hole has no sand or water at all.
    expect(sandSeen).toBeGreaterThan(0);
    expect(waterSeen).toBeGreaterThan(0);
  });
});

/**
 * Tier 2, docs/COURSE_PIPELINE.md §5. Water stops being "terrain below waterLevel" and becomes a
 * list of placed polygons.
 *
 * §5.1 is why: sampling all 18 holes found the course 37.5% underwater, holes 10 and 16 over 55%,
 * because `A_MACRO` is ~4.9 m of amplitude and any field large enough to span a macro period dips
 * under the -0.72 water line somewhere. That is not a hazard anyone placed; it is noise crossing a
 * threshold, and it flooded eleven holes whose briefs ask for no water at all.
 */
describe("water is placed, not inherited from terrain height", () => {
  const tee: Vec2 = { x: -45, z: 0 };
  const cup: Vec2 = { x: 45, z: 8 };
  const pond: Polygon = {
    points: [
      { x: -10, z: 20 },
      { x: 10, z: 20 },
      { x: 10, z: 40 },
      { x: -10, z: 40 },
    ],
  };

  function pondSpec(): HoleSpec {
    return { ...fixedHoleSpec(), tee, cup, water: [pond] };
  }

  it("classifies a point inside a water polygon as water, and only because of the polygon", () => {
    // Differential on purpose. Asserting `Water` at one point would also pass under the old
    // height rule if that point happened to sit below waterLevel -- which, on this fixture, it
    // does. Adding and removing the polygon isolates the polygon as the cause.
    const wet = pondSpec();
    const dry: HoleSpec = { ...wet, water: [] };
    expect(createSurfaces(wet, createTerrain(wet)).surfaceAt(0, 30)).toBe(SurfaceId.Water);
    expect(createSurfaces(dry, createTerrain(dry)).surfaceAt(0, 30)).not.toBe(SurfaceId.Water);
  });

  it("leaves low ground outside every polygon dry", () => {
    // The behaviour change that fixes §5.1. Find ground the old height rule would have drowned
    // and assert it is now playable. The `found` guard stops this passing vacuously on a hole
    // that happens to have no low ground at all.
    const spec = { ...fixedHoleSpec(), water: [] as readonly Polygon[] };
    const terrain2 = createTerrain(spec);
    const surf = createSurfaces(spec, terrain2);

    let found = 0;
    for (let x = -78; x < 78; x += 2.3) {
      for (let z = -78; z < 78; z += 2.3) {
        if (terrain2.heightAt(x, z) >= spec.waterLevel) continue;
        found += 1;
        expect(surf.surfaceAt(x, z)).not.toBe(SurfaceId.Water);
      }
    }
    expect(found, "fixture has no sub-waterLevel ground to test against").toBeGreaterThan(0);
  });

  it("holds no water at all on a hole whose brief asks for none", () => {
    const spec = { ...fixedHoleSpec(), water: [] as readonly Polygon[] };
    const surf = createSurfaces(spec, createTerrain(spec));
    for (let x = -78; x < 78; x += 3.1) {
      for (let z = -78; z < 78; z += 3.1) {
        expect(surf.surfaceAt(x, z)).not.toBe(SurfaceId.Water);
      }
    }
  });

  it("gives the green priority over water, so an island green is puttable", () => {
    // The classification order flips here. It used to be water-first, justified by water being
    // height-defined and therefore not overridable by a mowing pattern. Once water is placed,
    // that reasoning no longer applies and hole 13's island green -- a green deliberately ringed
    // by water -- needs the green to win.
    const moat: Polygon = {
      points: [
        { x: 20, z: -20 },
        { x: 70, z: -20 },
        { x: 70, z: 30 },
        { x: 20, z: 30 },
      ],
    };
    const spec = { ...fixedHoleSpec(), tee, cup, water: [moat] };
    const surf = createSurfaces(spec, createTerrain(spec));
    expect(surf.surfaceAt(cup.x, cup.z)).toBe(SurfaceId.Green);
    // ...while the moat around it is still water.
    expect(surf.surfaceAt(65, 25)).toBe(SurfaceId.Water);
  });
});

/**
 * Tier 2, second half. Bunkers stop being a noise threshold and become placed ellipses.
 *
 * §5.1's other finding: 3.6% of the *mown corridor* classified as sand, scattered as small
 * speckles across every fairway rather than as hazards anyone put there. A noise threshold
 * produces texture, not bunkers -- and no brief can ask for "a bunker where the aggressive line
 * lands" while sand is a field-wide function of position.
 */
describe("sand is placed, not thresholded from noise", () => {
  const bunker: Ellipse = { x: 20, z: 30, radiusX: 9, radiusZ: 5, rotation: 0.4 };

  it("classifies a point inside a bunker ellipse as sand, and only because of the ellipse", () => {
    const withBunker: HoleSpec = { ...fixedHoleSpec(), bunkers: [bunker] };
    const without: HoleSpec = { ...withBunker, bunkers: [] };
    expect(createSurfaces(withBunker, createTerrain(withBunker)).surfaceAt(20, 30)).toBe(
      SurfaceId.Sand,
    );
    expect(createSurfaces(without, createTerrain(without)).surfaceAt(20, 30)).not.toBe(
      SurfaceId.Sand,
    );
  });

  it("respects the ellipse's rotation and extent rather than its bounding box", () => {
    const spec: HoleSpec = { ...fixedHoleSpec(), bunkers: [bunker] };
    const surf = createSurfaces(spec, createTerrain(spec));
    // A corner of the bounding box, inside it and outside the rotated ellipse.
    expect(pointInEllipse(20 + 8.5, 30 + 4.5, bunker)).toBe(false);
    expect(surf.surfaceAt(20 + 8.5, 30 + 4.5)).not.toBe(SurfaceId.Sand);
  });

  it("leaves a hole with no bunkers entirely free of sand", () => {
    // The §5.1 confetti fix. Eleven of the eighteen briefs place bunkers; the rest must be clean.
    const spec: HoleSpec = { ...fixedHoleSpec(), bunkers: [] };
    const surf = createSurfaces(spec, createTerrain(spec));
    for (let x = -78; x < 78; x += 2.7) {
      for (let z = -78; z < 78; z += 2.7) {
        expect(surf.surfaceAt(x, z)).not.toBe(SurfaceId.Sand);
      }
    }
  });

  it("puts no sand on the mown corridor unless a bunker was placed there", () => {
    const spec: HoleSpec = { ...fixedHoleSpec(), bunkers: [bunker] };
    const surf = createSurfaces(spec, createTerrain(spec));
    for (let t = 0; t <= 1; t += 0.01) {
      const p = terrain.spline.pointAt(t);
      expect(surf.surfaceAt(p.x, p.z)).not.toBe(SurfaceId.Sand);
    }
  });
});

describe("per-hole corridor width", () => {
  it("classifies the same point fairway on a wide hole and rough on a narrow one", () => {
    const narrow: HoleSpec = { ...SPEC, corridor: [10, 10, 10] };
    const wide: HoleSpec = { ...SPEC, corridor: [22, 22, 22] };
    const narrowSurf = createSurfaces(narrow, createTerrain(narrow));
    const wideSurf = createSurfaces(wide, createTerrain(wide));

    const p = acrossCorridor(0.8, 18);
    expect(wideSurf.surfaceAt(p.x, p.z)).toBe(SurfaceId.Fairway);
    expect(narrowSurf.surfaceAt(p.x, p.z)).toBe(SurfaceId.Rough);
  });

  it("follows a corridor that pinches in the middle and reopens at the green", () => {
    // The shape the briefs ask for: narrow through the landing zone, wide at each end.
    const spec: HoleSpec = { ...SPEC, corridor: [20, 10, 20] };
    const surf = createSurfaces(spec, createTerrain(spec));
    const out = createSurfaceWeights();

    const near = acrossCorridor(0.05, 15);
    const middle = acrossCorridor(0.5, 15);
    surf.weightsAt(near.x, near.z, out);
    const atTee = out.corridor;
    surf.weightsAt(middle.x, middle.z, out);
    expect(out.corridor).toBeGreaterThan(atTee);
  });

  it("reproduces today's classification when every control point carries HALF_WIDTH", () => {
    const uniform: HoleSpec = {
      ...SPEC,
      corridor: [HALF_WIDTH, HALF_WIDTH, HALF_WIDTH],
    };
    const uniformSurf = createSurfaces(uniform, createTerrain(uniform));
    for (let x = -70; x <= 70; x += 7) {
      for (let z = -70; z <= 70; z += 7) {
        expect(uniformSurf.surfaceAt(x, z)).toBe(surfaces.surfaceAt(x, z));
      }
    }
  });
});

/**
 * Tier 2. The green stops being `GREEN_RADIUS` about the cup and becomes an ellipse, so a green
 * can be long-and-narrow or angled to the approach.
 */
describe("elliptical greens", () => {
  const longGreen: Ellipse = {
    x: SPEC.cup.x,
    z: SPEC.cup.z,
    radiusX: 18,
    radiusZ: 8,
    rotation: 0,
  };

  it("reaches further along the long axis than a circular green would", () => {
    const spec: HoleSpec = { ...SPEC, green: longGreen };
    const surf = createSurfaces(spec, createTerrain(spec));
    // 15 m out on the long axis: outside GREEN_RADIUS, inside this green.
    expect(15).toBeGreaterThan(GREEN_RADIUS);
    expect(surf.surfaceAt(SPEC.cup.x + 15, SPEC.cup.z)).toBe(SurfaceId.Green);
    // 15 m out on the short axis: outside both.
    expect(surf.surfaceAt(SPEC.cup.x, SPEC.cup.z + 15)).not.toBe(SurfaceId.Green);
  });

  it("rotates with the ellipse", () => {
    const turned: HoleSpec = { ...SPEC, green: { ...longGreen, rotation: Math.PI / 2 } };
    const surf = createSurfaces(turned, createTerrain(turned));
    expect(surf.surfaceAt(SPEC.cup.x + 15, SPEC.cup.z)).not.toBe(SurfaceId.Green);
    expect(surf.surfaceAt(SPEC.cup.x, SPEC.cup.z + 15)).toBe(SurfaceId.Green);
  });

  it("blends the green's rolling resistance out across its own rim, not a circle's", () => {
    const spec: HoleSpec = { ...SPEC, green: longGreen };
    const surf = createSurfaces(spec, createTerrain(spec));
    const out = createSurfaceWeights();
    surf.weightsAt(SPEC.cup.x + 15, SPEC.cup.z, out);
    expect(out.green).toBeLessThan(0.5);
    surf.weightsAt(SPEC.cup.x, SPEC.cup.z + 15, out);
    expect(out.green).toBeGreaterThan(0.5);
  });

  it("reproduces today's classification for a circular green of GREEN_RADIUS", () => {
    const circular: HoleSpec = { ...SPEC, green: defaultGreen(SPEC.cup) };
    const surf = createSurfaces(circular, createTerrain(circular));
    for (let x = -70; x <= 70; x += 7) {
      for (let z = -70; z <= 70; z += 7) {
        expect(surf.surfaceAt(x, z)).toBe(surfaces.surfaceAt(x, z));
      }
    }
  });
});

/**
 * `SurfaceId.Bridge` -- the drivable crossing (spec D5).
 *
 * **The ordering is the entire trick and it is one line.** `surfaceAt` is a priority list, and the
 * bridge test has to come *before* the water test: the deck is by construction inside a water
 * polygon, so a chain that asks "is this water?" first classifies the whole causeway as a hazard and
 * charges a stroke to everything that drives across it. The test below is written to go red with
 * those two lines swapped, and that was confirmed rather than assumed.
 */
describe("the crossing surface", () => {
  /** A pond straddling the corridor, so the derived causeway crosses it. */
  const CROSSED: HoleSpec = {
    ...SPEC,
    water: [
      {
        points: [
          { x: -20, z: -40 },
          { x: 4, z: -40 },
          { x: 4, z: 40 },
          { x: -20, z: 40 },
        ],
      },
    ],
  };
  const crossedTerrain = createTerrain(CROSSED);
  const crossed = createSurfaces(CROSSED, crossedTerrain);
  const deck = deriveCrossings(CROSSED)[0]!;

  /** A point `offset` metres square across the deck from its midpoint. */
  function across(offset: number): { x: number; z: number } {
    const dx = deck.bx - deck.ax;
    const dz = deck.bz - deck.az;
    const length = Math.hypot(dx, dz);
    return {
      x: (deck.ax + deck.bx) / 2 - (dz / length) * offset,
      z: (deck.az + deck.bz) / 2 + (dx / length) * offset,
    };
  }

  it("reads Bridge on the deck and Water a metre off its shoulder", () => {
    const onDeck = across(0);
    expect(crossed.surfaceAt(onDeck.x, onDeck.z)).toBe(SurfaceId.Bridge);

    const offShoulder = across(DECK_HALF_WIDTH + DECK_SHOULDER_RUN + 1);
    expect(crossed.surfaceAt(offShoulder.x, offShoulder.z)).toBe(SurfaceId.Water);
  });

  it("carries the shoulders too, so a cart leaving the deck is not in the water yet", () => {
    // The shoulders are ground the causeway raised above the pond. Classifying them as water would
    // charge a stroke for standing on the ramp the deck is reached by.
    for (const offset of [DECK_HALF_WIDTH + 0.5, DECK_HALF_WIDTH + DECK_SHOULDER_RUN - 0.5]) {
      const point = across(offset);
      expect(crossed.surfaceAt(point.x, point.z), `${offset} m out`).toBe(SurfaceId.Bridge);
    }
  });

  it("is not a hazard, unlike the water it crosses", () => {
    expect(SURFACES[SurfaceId.Bridge].isHazard).toBe(false);
    expect(SURFACES[SurfaceId.Water].isHazard).toBe(true);
  });

  it("is hard and fast: a deck rolls further than a green and drives at full speed", () => {
    // Spec D5. Planks, not turf.
    expect(SURFACES[SurfaceId.Bridge].rolling).toBeLessThan(SURFACES[SurfaceId.Green].rolling);
    expect(SURFACES[SurfaceId.Bridge].bounceScale).toBeGreaterThan(SURFACES[SurfaceId.Green].bounceScale);
    expect(SURFACES[SurfaceId.Bridge].cartSpeedScale).toBe(1);
  });

  it("keeps a hard edge in tuningAt rather than blending into the pond", () => {
    // Sand and water keep hard edges for the same reason a bunker lip is abrupt; a deck edge is a
    // plank against open water and is more abrupt still. Blended, a ball would drift to a halt
    // somewhere between the two.
    const onDeck = across(0);
    const tuning = createSurfaceTuning();
    crossed.tuningAt(onDeck.x, onDeck.z, tuning);
    expect(tuning.rolling).toBeCloseTo(SURFACES[SurfaceId.Bridge].rolling, 9);
    expect(tuning.bounceScale).toBeCloseTo(SURFACES[SurfaceId.Bridge].bounceScale, 9);
    expect(tuning.isHazard).toBe(false);
  });

  it("publishes a hard-edged bridge weight beside sand and water", () => {
    const onDeck = across(0);
    const weights = createSurfaceWeights();
    crossed.weightsAt(onDeck.x, onDeck.z, weights);
    expect(weights.bridge).toBe(1);
    expect(weights.water).toBe(0);

    const offShoulder = across(DECK_HALF_WIDTH + DECK_SHOULDER_RUN + 1);
    crossed.weightsAt(offShoulder.x, offShoulder.z, weights);
    expect(weights.bridge).toBe(0);
    expect(weights.water).toBe(1);
  });

  it("leaves a hole with no water carrying no bridge anywhere", () => {
    expect(surfaces.surfaceAt(0, 0)).not.toBe(SurfaceId.Bridge);
    const weights = createSurfaceWeights();
    surfaces.weightsAt(0, 0, weights);
    expect(weights.bridge).toBe(0);
  });
});
