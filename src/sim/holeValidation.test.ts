import { describe, expect, it } from "vitest";
import { biomeForIndex, defaultGreen, isWaterAt, stripeAngleFor } from "./course";
import type { HoleSpec } from "./course";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
import { pointInPolygon } from "./hazards";
import { EDGE_MARGIN, MAX_CAMBER_GRAD, MIN_HOLE_LENGTH, validateHole } from "./holeValidation";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { createSpline } from "./spline";

/**
 * Test terrains, so each check can be violated in isolation. validateHole only ever reads
 * `heightAt` and `spline` off a Terrain, both public, so a stand-in is honest rather than a
 * back door -- and it is the only way to make "check 3 rejects a spec that violates only
 * check 3" a real statement.
 */
function fakeTerrain(spec: HoleSpec, heightAt: (x: number, z: number) => number): Terrain {
  return {
    spec,
    spline: createSpline(spec.control),
    heightAt,
    buildHeightfield: () => new Float32Array(0),
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z), z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}

/**
 * A legal par 4 running west to east down the middle of a 220 m field.
 *
 * +-75 m, not +-80: room in a 220 m field is 110 - 15 - 10 - 6 = 79 m (see the check-2 test
 * below), so +-80 would put even this "legal" hole's tee and cup 1 m outside the corridor box.
 */
function validSpec(overrides: Partial<HoleSpec> = {}): HoleSpec {
  const tee = { x: -75, z: 0 };
  const cup = { x: 75, z: 0 };
  return {
    seed: 1,
    index: 0,
    fieldSize: 220,
    cells: 220,
    tee,
    cup,
    control: [tee, { x: 0, z: 0 }, cup],
    par: 4,
    waterLevel: -0.72,
    water: [],
    bunkers: [],
    green: defaultGreen(cup),
    corridor: [HALF_WIDTH, HALF_WIDTH, HALF_WIDTH],
    biome: biomeForIndex(0),
    stripeAngle: stripeAngleFor(1, 0, tee, cup),
    ...overrides,
  };
}

const FLAT = (): number => 0;

describe("validateHole", () => {
  it("accepts a legal hole on flat ground", () => {
    const spec = validSpec();
    expect(validateHole(spec, fakeTerrain(spec, FLAT))).toBeNull();
  });

  it("check 1 rejects a tee and cup closer than MIN_HOLE_LENGTH", () => {
    const tee = { x: -20, z: 0 };
    const cup = { x: 20, z: 0 };
    const spec = validSpec({ tee, cup, control: [tee, { x: 0, z: 0 }, cup] });
    expect(Math.hypot(cup.x - tee.x, cup.z - tee.z)).toBeLessThan(MIN_HOLE_LENGTH);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(1);
  });

  it("check 2 rejects a corridor that leaves the field", () => {
    // Room in a 220 m field is 110 - 15 - 10 - 6 = 79 m; put the apex outside it.
    const tee = { x: -70, z: 0 };
    const cup = { x: 70, z: 0 };
    const spec = validSpec({ tee, cup, control: [tee, { x: 0, z: -100 }, cup] });
    expect(110 - HALF_WIDTH - BLEND_WIDTH - EDGE_MARGIN).toBe(79);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(2);
  });

  it("check 3 rejects a corridor climbing steeper than tan(6.27 deg)", () => {
    const spec = validSpec();
    // Ramp along the corridor's own direction: longitudinal, with zero cross-slope. Anchored
    // at the tee (rather than at world x=0) so the climb stays above waterLevel everywhere on
    // the corridor -- otherwise the far (low) end would flood and trip check 6 before the
    // grade itself ever gets sampled, which would test check 6, not check 3.
    const ramp = (x: number): number => (x - spec.tee.x) * 0.2;
    expect(validateHole(spec, fakeTerrain(spec, ramp))?.check).toBe(3);
  });

  it("check 4 rejects a corridor cambered steeper than tan(4 deg)", () => {
    const spec = validSpec();
    // Ramp perpendicular to a west-east corridor: pure camber, zero longitudinal grade.
    const camber = (_x: number, z: number): number => z * 0.2;
    expect(camber(0, 1)).toBeGreaterThan(MAX_CAMBER_GRAD);
    expect(validateHole(spec, fakeTerrain(spec, camber))?.check).toBe(4);
  });

  it("check 5 rejects a green steeper than tan(3.43 deg)", () => {
    const spec = validSpec();
    // A shallow cone with its apex exactly at the cup: steep inside the green, flat outside,
    // and zero at the cup itself so the corridor's own longitudinal grade stays legal.
    const cone = (x: number, z: number): number => {
      const r = Math.hypot(x - spec.cup.x, z - spec.cup.z);
      return r < GREEN_RADIUS ? r * 0.1 : GREEN_RADIUS * 0.1;
    };
    expect(validateHole(spec, fakeTerrain(spec, cone))?.check).toBe(5);
  });

  /**
   * Check 6 changed shape in Tier 2, and the change is not a relaxation of the old rule -- it is
   * a different rule, because the old one had become unsatisfiable for three of the eighteen
   * briefs.
   *
   * It used to be "the centreline is never below waterLevel", which was correct while water *was*
   * terrain height. docs/COURSE_PIPELINE.md §5 proposed relaxing it to "the centreline is never
   * inside a water polygon" -- but holes 2, 13 and 15 are forced carries and island greens, whose
   * entire design is a centreline that crosses water. Under that wording they would have been
   * exactly as unbuildable as before, just for a new reason.
   *
   * What a player actually needs is that the water be *carryable*, and that they have somewhere
   * to stand and somewhere to land. So: tee dry, cup dry, and no single wet run longer than the
   * driver's carry.
   */
  const drown = (points: readonly { x: number; z: number }[]) => ({ points });

  it("check 5 polices the whole of an elongated green, not the circle inside it", () => {
    // A green 18 m long on the approach axis. A steep patch at 15 m from the cup is on the
    // putting surface but outside GREEN_RADIUS, so a check that samples a circle of
    // GREEN_RADIUS would call this hole legal and ship an unputtable green.
    const spec = validSpec({
      green: { x: 75, z: 0, radiusX: 18, radiusZ: 8, rotation: 0 },
    });
    expect(15).toBeGreaterThan(GREEN_RADIUS);
    // Off the centreline (|z| >= 1.5) so the corridor's own longitudinal grade stays legal and
    // check 3 cannot fire first -- this has to be check 5 or it is testing nothing.
    const steepFarEnd = (x: number, z: number): number => {
      const along = Math.abs(x - spec.cup.x);
      const off = Math.abs(z);
      return along > 12 && along < 18 && off > 1.5 && off < 4.5 ? (along - 12) * 0.2 : 0;
    };
    expect(validateHole(spec, fakeTerrain(spec, steepFarEnd))?.check).toBe(5);
  });

  it("check 6 rejects a hole whose tee is under water", () => {
    const spec = validSpec({
      water: [drown([
        { x: -90, z: -20 },
        { x: -60, z: -20 },
        { x: -60, z: 20 },
        { x: -90, z: 20 },
      ])],
    });
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(6);
  });

  it("check 6 rejects a green ringed by more water than the driver can carry", () => {
    // There is no "is the cup wet" check and there should not be: the green beats water in
    // `isWaterAt`, so a cup is dry by construction, and a green ringed by water is hole 13 rather
    // than a defect. What makes an over-watered green unplayable is the carry it demands, so that
    // is what is measured -- a 90 m moat here against a 69.5 m carry.
    const spec = validSpec({
      water: [drown([
        { x: -15, z: -60 },
        { x: 105, z: -60 },
        { x: 105, z: 60 },
        { x: -15, z: 60 },
      ])],
    });
    expect(isWaterAt(spec, spec.cup.x, spec.cup.z)).toBe(false);
    const rejection = validateHole(spec, fakeTerrain(spec, FLAT));
    expect(rejection?.check).toBe(6);
    expect(rejection?.reason).toMatch(/carry/);
  });

  it("check 6 rejects a wet run longer than the driver can carry", () => {
    // 100 m of water across a corridor running west to east. DRIVER_CARRY_M is 69.5.
    const spec = validSpec({
      water: [drown([
        { x: -50, z: -40 },
        { x: 50, z: -40 },
        { x: 50, z: 40 },
        { x: -50, z: 40 },
      ])],
    });
    expect(100).toBeGreaterThan(DRIVER_CARRY_M);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(6);
  });

  it("check 6 accepts a crossing the driver can carry", () => {
    // 30 m of water across the same corridor: hole 2's forced carry, and the case the §5 wording
    // would have rejected. This is the assertion that makes holes 2, 13 and 15 buildable at all.
    const spec = validSpec({
      water: [drown([
        { x: -15, z: -40 },
        { x: 15, z: -40 },
        { x: 15, z: 40 },
        { x: -15, z: 40 },
      ])],
    });
    expect(30).toBeLessThan(DRIVER_CARRY_M);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))).toBeNull();
  });

  it("check 6 accepts an island green, whose cup sits inside a water polygon", () => {
    // Hole 13. The moat is drawn solid through the cup because polygons here have no holes; the
    // green is punched back out of it by classification order. Testing the raw polygon would
    // reject the archetype outright, so check 6 goes through `isWaterAt`, which knows the green
    // wins. Delete the green clause in `isWaterAt` and this is the test that fails.
    const spec = validSpec({
      water: [drown([
        { x: 45, z: -30 },
        { x: 105, z: -30 },
        { x: 105, z: 30 },
        { x: 45, z: 30 },
      ])],
    });
    expect(pointInPolygon(spec.cup.x, spec.cup.z, spec.water[0]!)).toBe(true);
    expect(isWaterAt(spec, spec.cup.x, spec.cup.z)).toBe(false);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))).toBeNull();
  });

  it("does not measure grade or camber across a hazard it just allowed", () => {
    // The bank of a legal crossing is a cliff by design -- WATER_DEPTH is 1.5 m over a
    // WATER_SHORE of 6 m, a 0.25 grade against check 3's 0.11 limit. Checks 3 and 4 are about
    // whether the *playing surface* is fair; water is not a playing surface, and sampling it
    // would make every forced carry fail as a slope defect.
    const spec = validSpec({
      water: [drown([
        { x: -15, z: -40 },
        { x: 15, z: -40 },
        { x: 15, z: 40 },
        { x: -15, z: 40 },
      ])],
    });
    // Real terrain, not FLAT: the basin is actually carved here.
    const rejection = validateHole(spec, createTerrain(spec));
    expect(rejection?.check).not.toBe(3);
    expect(rejection?.check).not.toBe(4);
  });

  it("check 7 rejects a corridor longer than three full driver shots", () => {
    // 3 * 129 = 387 m. A 500 m field with a 460 m straight corridor busts it -- and the field
    // is large enough that check 2 still passes, so 7 is the only violation.
    const tee = { x: -230, z: 0 };
    const cup = { x: 230, z: 0 };
    const spec = validSpec({
      fieldSize: 600,
      cells: 600,
      tee,
      cup,
      control: [tee, { x: 0, z: 0 }, cup],
    });
    expect(460).toBeGreaterThan(3 * REFERENCE_CARRY_M);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(7);
  });

  it("names the failing check and says why, so a rejection is diagnosable", () => {
    const spec = validSpec();
    const rejection = validateHole(spec, fakeTerrain(spec, (x) => (x - spec.tee.x) * 0.2));
    expect(rejection?.reason).toMatch(/longitudinal/i);
  });
});
