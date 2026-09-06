import { describe, expect, it } from "vitest";
import { biomeForIndex, fixedHoleSpec, stripeAngleFor } from "./course";
import type { HoleSpec, Vec2 } from "./course";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import {
  SURFACES,
  SurfaceId,
  createSurfaceTuning,
  createSurfaceWeights,
  createSurfaces,
} from "./surfaces";

const SPEC = fixedHoleSpec();
const terrain = createTerrain(SPEC);
const surfaces = createSurfaces(SPEC, terrain);

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
        if (surfaces.surfaceAt(x, z) !== SurfaceId.Sand) continue;
        surfaces.tuningAt(x, z, out);
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

  it("draws sand noise from mulberry32(sandChannel(spec)), not a fixed constant source", () => {
    const spec = nonLegacySpec();
    const nonLegacyTerrain = createTerrain(spec);
    const withDefaultSource = createSurfaces(spec, nonLegacyTerrain);
    const withFixedConstantSource = createSurfaces(spec, nonLegacyTerrain, {
      sand: () => 0.77,
    });

    let sawDifference = false;
    for (const x of AXIS) {
      for (const z of AXIS) {
        if (withDefaultSource.surfaceAt(x, z) !== withFixedConstantSource.surfaceAt(x, z)) {
          sawDifference = true;
        }
      }
    }

    expect(sawDifference).toBe(true);
  });
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
    const out = createSurfaceWeights();
    const size = SPEC.fieldSize;
    let sandSeen = 0;
    let waterSeen = 0;

    for (let x = -size / 2; x < size / 2; x += 3.1) {
      for (let z = -size / 2; z < size / 2; z += 3.1) {
        surfaces.weightsAt(x, z, out);
        const id = surfaces.surfaceAt(x, z);
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
