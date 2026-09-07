import { describe, expect, it } from "vitest";
import { defaultGreen, fixedHoleSpec, isWaterAt } from "./course";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
import { pointInPolygon } from "./hazards";
import { briefForHole } from "./briefs";
import { SurfaceId, createSurfaceWeights, createSurfaces } from "./surfaces";
import {
  EDGE_MARGIN,
  MAX_ATTEMPTS,
  MAX_CAMBER_GRAD,
  MIN_HOLE_LENGTH,
  derivePar,
  generateCourse,
  generateHole,
  STRIPE_JITTER,
  biomeForIndex,
  parForIndex,
  stripeAngleFor,
  validateHole,
} from "./course";
import type { BiomeId, HoleSpec } from "./course";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, WOODS_WEIGHT, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { createSpline } from "./spline";

describe("fixedHoleSpec", () => {
  it("holds a cell size near 1 m, which the ball radius depends on", () => {
    const spec = fixedHoleSpec();
    expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
  });

  it("has a corridor running tee first, cup last, with a dog-leg between", () => {
    const spec = fixedHoleSpec();
    expect(spec.control.length).toBeGreaterThanOrEqual(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(fixedHoleSpec()).not.toBe(fixedHoleSpec());
    expect(fixedHoleSpec()).toEqual(fixedHoleSpec());
  });
});

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

describe("derivePar", () => {
  it("puts one full driver at par 3 and clamps to [3, 5]", () => {
    expect(derivePar(10)).toBe(3);
    expect(derivePar(REFERENCE_CARRY_M - 1)).toBe(3);
    expect(derivePar(REFERENCE_CARRY_M + 1)).toBe(4);
    expect(derivePar(2 * REFERENCE_CARRY_M + 1)).toBe(5);
    expect(derivePar(10 * REFERENCE_CARRY_M)).toBe(5);
  });
});

describe("generateHole", () => {
  it("is byte-identical across repeated calls", () => {
    expect(generateHole(4242, 3)).toEqual(generateHole(4242, 3));
  });

  it("is independent of call order", () => {
    const first = generateHole(4242, 3);
    generateHole(4242, 0);
    generateHole(99, 3);
    generateHole(4242, 7);
    expect(generateHole(4242, 3)).toEqual(first);
  });

  it("differs between holes of the same course and between courses", () => {
    expect(generateHole(4242, 0)).not.toEqual(generateHole(4242, 1));
    expect(generateHole(4242, 0)).not.toEqual(generateHole(4243, 0));
  });

  it("produces a hole that passes its own checks", () => {
    const spec = generateHole(4242, 3);
    expect(validateHole(spec, createTerrain(spec))).toBeNull();
  });

  it("derives par from the corridor rather than copying the intended par", () => {
    const spec = generateHole(4242, 3);
    expect(spec.par).toBe(derivePar(createTerrain(spec).spline.length));
  });

  it("sizes the field from the intended par and keeps the cell near 1 m", () => {
    for (const [par, fieldSize] of [[3, 160], [4, 220], [5, 300]] as const) {
      const spec = generateHole(777, 0, par);
      expect(spec.fieldSize).toBe(fieldSize);
      expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
      expect(spec.par).toBe(par);
    }
  });

  /**
   * The `control` contract, which is what `createSpline` and `halfWidthAt` both depend on: tee
   * first, cup last, at least three points. The count is no longer always three -- an s-curve
   * brief drafts four -- so this asserts the invariant rather than the number it used to be.
   * Which briefs bend which way, and by how much, is `routing.test.ts`.
   */
  it("puts the tee first and the cup last, over at least three control points", () => {
    for (const index of [0, 3, 6, 12, 17]) {
      const spec = generateHole(4242, index);
      expect(spec.control.length, `hole index ${index}`).toBeGreaterThanOrEqual(3);
      expect(spec.control[0]).toEqual(spec.tee);
      expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
      expect(spec.corridor.length, `hole index ${index} corridor`).toBe(spec.control.length);
    }
  });

  it("throws rather than returning an invalid hole when attempts run out", () => {
    expect(() =>
      generateHole(1, 0, 4, { validate: () => ({ check: 99, reason: "always rejects" }) }),
    ).toThrow(new RegExp(`${MAX_ATTEMPTS}`));
  });

  it("names the last rejection when it throws, so exhaustion is diagnosable", () => {
    expect(() =>
      generateHole(1, 0, 4, { validate: () => ({ check: 99, reason: "always rejects" }) }),
    ).toThrow(/always rejects/);
  });
});

/**
 * §9 build order step 6, arriving with Tier 2 rather than after it: without this the four new
 * HoleSpec fields exist and are always empty, which is the "data with no consumer" problem the
 * whole COURSE_PIPELINE document is about.
 */
describe("generateHole reads the hole's brief", () => {
  it("takes its corridor widths from the brief's cover setting", () => {
    // Hole 5 is `dense` (a knife fight), hole 9 is `open` (a shooting gallery).
    expect(generateHole(4242, 4).corridor).toEqual([11, 10, 12]);
    expect(generateHole(4242, 8).corridor).toEqual([19, 18, 19]);
  });

  it("places water on the holes whose briefs ask for it and none on the others", () => {
    // Hole 2 is a forced carry; hole 1 is a gentle opener with no water at all.
    expect(generateHole(4242, 1).water.length).toBeGreaterThan(0);
    expect(generateHole(4242, 0).water).toEqual([]);
  });

  it("places exactly as many bunkers as the brief declares", () => {
    for (const index of [0, 2, 3, 5, 10]) {
      expect(generateHole(4242, index).bunkers).toHaveLength(
        briefForHole(index + 1).hazards.bunkers.count,
      );
    }
  });

  it("leaves no sand on a hole whose brief places no bunkers", () => {
    // Hole 2's brief has no bunkers -- under the old noise scatter it had sand anyway.
    expect(briefForHole(2).hazards.bunkers.count).toBe(0);
    expect(generateHole(4242, 1).bunkers).toEqual([]);
  });

  it("never puts sand in the woods", () => {
    // Sand belongs to the fairway and the first cut beside it. A bunker out among the trees is
    // not a hazard anybody plays around -- it is a sand patch in a forest, and it was the last
    // thing left over from the noise-scatter era's geography.
    //
    // "The woods" is not a new idea invented here: it is exactly where `Trees.ts` plants, which
    // is `corridorWeight >= WOODS_WEIGHT`. Asserting against that constant rather than a distance
    // means sand and trees can never end up in the same place by construction, on any corridor
    // width, and the two cannot drift apart later.
    const course = generateCourse(0x7ee7c0, 18);
    const weights = createSurfaceWeights();
    const offenders: string[] = [];

    for (const spec of course.holes) {
      const terrain = createTerrain(spec);
      const surfaces = createSurfaces(spec, terrain);
      let sandSeen = 0;
      for (let x = -spec.fieldSize / 2; x < spec.fieldSize / 2; x += 1.5) {
        for (let z = -spec.fieldSize / 2; z < spec.fieldSize / 2; z += 1.5) {
          if (surfaces.surfaceAt(x, z) !== SurfaceId.Sand) continue;
          sandSeen += 1;
          surfaces.weightsAt(x, z, weights);
          if (weights.corridor >= WOODS_WEIGHT) {
            offenders.push(
              `hole ${spec.index + 1} at (${x.toFixed(0)}, ${z.toFixed(0)}) ` +
                `corridor ${weights.corridor.toFixed(3)}`,
            );
          }
        }
      }
      // Guard: a hole with no sand at all would satisfy the loop above vacuously.
      if (spec.bunkers.length > 0) {
        expect(sandSeen, `hole ${spec.index + 1} places bunkers but shows no sand`).toBeGreaterThan(
          0,
        );
      }
    }

    expect(offenders.slice(0, 8)).toEqual([]);
  });

  it("stays deterministic now that hazards are placed", () => {
    expect(generateHole(4242, 6)).toEqual(generateHole(4242, 6));
    expect(generateHole(4242, 6)).not.toEqual(generateHole(4243, 6));
  });

  it("builds all eighteen holes of the course bible", () => {
    // The end-to-end claim: every brief in the bible produces a hole that passes every check.
    // Before Tier 2 the archetypes with water were unbuildable by construction.
    const course = generateCourse(0x7ee7c0, 18);
    expect(course.holes).toHaveLength(18);
    expect(course.holes.reduce((sum, h) => sum + h.par, 0)).toBe(72);
  });
});

describe("generateCourse", () => {
  it("builds a par-36 front nine", () => {
    const course = generateCourse(2026, 9);
    expect(course.holes).toHaveLength(9);
    expect(course.holes.reduce((sum, h) => sum + h.par, 0)).toBe(36);
  });

  it("indexes every hole by its position", () => {
    const course = generateCourse(2026, 9);
    course.holes.forEach((hole, i) => expect(hole.index).toBe(i));
  });

  it("is deterministic", () => {
    expect(generateCourse(2026, 9)).toEqual(generateCourse(2026, 9));
  });

  it("gives a different course a different set of holes", () => {
    expect(generateCourse(2026, 9).holes[0]).not.toEqual(generateCourse(2027, 9).holes[0]);
  });

  it("carries an id and a name derived from the seed", () => {
    const course = generateCourse(2026, 9);
    expect(course.seed).toBe(2026);
    expect(course.id).toContain("2026");
    expect(course.name.length).toBeGreaterThan(0);
  });

  it("every hole passes all seven checks", () => {
    for (const hole of generateCourse(2026, 9).holes) {
      expect(validateHole(hole, createTerrain(hole))).toBeNull();
    }
  });

  it("cycles the par mix past the eighteenth hole", () => {
    expect(generateCourse(2026, 18).holes).toHaveLength(18);
    expect(parForIndex(18)).toBe(parForIndex(0));
    expect(parForIndex(-1)).toBe(parForIndex(17));
  });
});

/** Smallest absolute angle between two bearings, handling wrap. */
function angularDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % (Math.PI * 2);
  return raw > Math.PI ? Math.PI * 2 - raw : raw;
}

describe("biomeForIndex", () => {
  it("follows the course bible's four contiguous stretches", () => {
    // docs/COURSE_PIPELINE.md section 4: holes 1-5 parkland, 6-11 links, 12-15 marsh,
    // 16-18 a parkland return. Written out per hole rather than as a loop over the same
    // table the implementation uses -- a loop would pass by construction.
    const expected: BiomeId[] = [
      "parkland", "parkland", "parkland", "parkland", "parkland",
      "links", "links", "links", "links", "links", "links",
      "marsh", "marsh", "marsh", "marsh",
      "parkland", "parkland", "parkland",
    ];
    for (let index = 0; index < 18; index++) {
      expect(biomeForIndex(index)).toBe(expected[index]);
    }
  });

  it("uses three distinct biomes and no more", () => {
    const seen = new Set<BiomeId>();
    for (let index = 0; index < 18; index++) seen.add(biomeForIndex(index));
    expect(seen.size).toBe(3);
  });

  it("cycles past the eighteenth hole and tolerates a negative index", () => {
    expect(biomeForIndex(18)).toBe(biomeForIndex(0));
    expect(biomeForIndex(25)).toBe(biomeForIndex(7));
    expect(biomeForIndex(-1)).toBe(biomeForIndex(17));
  });
});

describe("hole biome and mowing stripes", () => {
  it("puts the bible's biome on every hole of an eighteen-hole course", () => {
    const course = generateCourse(0x51de, 18);
    for (const hole of course.holes) {
      expect(hole.biome).toBe(biomeForIndex(hole.index));
    }
  });

  it("gives fixedHoleSpec both fields", () => {
    const spec = fixedHoleSpec();
    expect(spec.biome).toBe(biomeForIndex(0));
    expect(Number.isFinite(spec.stripeAngle)).toBe(true);
  });

  it("mows along the tee-to-cup line, within the jitter budget", () => {
    // The stripe angle is not arbitrary: bands run across the fairway because the angle tracks
    // the playing line. A constant or a purely random angle would both pass a "is finite" check
    // and neither would look like a mown fairway, so this asserts the relationship.
    const course = generateCourse(0x51de, 18);
    for (const hole of course.holes) {
      const bearing = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
      expect(angularDelta(hole.stripeAngle, bearing)).toBeLessThanOrEqual(STRIPE_JITTER + 1e-9);
    }
  });

  it("varies the stripe angle between holes rather than pinning it to the bearing", () => {
    const course = generateCourse(0x51de, 18);
    const offsets = course.holes.map((hole) => {
      const bearing = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
      return angularDelta(hole.stripeAngle, bearing);
    });
    // If the jitter were dropped, every offset would be exactly 0 and the fairways would all
    // mow identically relative to their own line.
    expect(Math.max(...offsets)).toBeGreaterThan(0.02);
    expect(new Set(offsets.map((o) => o.toFixed(6))).size).toBeGreaterThan(10);
  });

  it("is deterministic in the course seed", () => {
    const a = generateCourse(0x51de, 18);
    const b = generateCourse(0x51de, 18);
    for (let i = 0; i < 18; i++) {
      expect(a.holes[i]!.stripeAngle).toBe(b.holes[i]!.stripeAngle);
      expect(a.holes[i]!.biome).toBe(b.holes[i]!.biome);
    }
    const other = generateCourse(0x51df, 18);
    expect(other.holes[0]!.stripeAngle).not.toBe(a.holes[0]!.stripeAngle);
  });
});

describe("parForIndex", () => {
  it("follows the course bible's card, front and back", () => {
    // docs/COURSE_PIPELINE.md section 4. Written out per hole rather than looped over the same
    // table the implementation reads -- a loop over that would pass by construction.
    const card = [4, 3, 4, 5, 4, 3, 4, 4, 5, 4, 5, 4, 3, 4, 4, 3, 4, 5];
    for (let index = 0; index < 18; index++) {
      expect(parForIndex(index)).toBe(card[index]);
    }
  });

  it("is par 36 out, 36 in, 72 around", () => {
    const par = (from: number, to: number): number => {
      let total = 0;
      for (let i = from; i < to; i++) total += parForIndex(i);
      return total;
    };
    expect(par(0, 9)).toBe(36);
    expect(par(9, 18)).toBe(36);
    expect(par(0, 18)).toBe(72);
  });

  it("does not simply repeat the front nine on the back", () => {
    // Both nines sum to 36, so a totals-only check would pass on a cycled nine-hole mix -- which
    // is exactly what this used to be.
    const front = Array.from({ length: 9 }, (_, i) => parForIndex(i));
    const back = Array.from({ length: 9 }, (_, i) => parForIndex(i + 9));
    expect(back).not.toEqual(front);
  });

  it("gives a generated eighteen-hole course the card's par at every hole", () => {
    // The generator only uses parForIndex to pick a field size; the par on the spec is derived
    // from the corridor the spline actually produced. If those two disagree the card is a
    // fiction, so this asserts the whole path rather than the table alone.
    for (const hole of generateCourse(2026, 18).holes) {
      expect(hole.par).toBe(parForIndex(hole.index));
    }
  });
});
