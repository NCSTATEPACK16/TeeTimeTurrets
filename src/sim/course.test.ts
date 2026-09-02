import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import {
  EDGE_MARGIN,
  MAX_ATTEMPTS,
  MAX_CAMBER_GRAD,
  MIN_HOLE_LENGTH,
  REFERENCE_CARRY_M,
  derivePar,
  generateCourse,
  generateHole,
  parForIndex,
  validateHole,
} from "./course";
import type { HoleSpec } from "./course";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
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

  it("check 6 rejects a corridor running below the water level", () => {
    const spec = validSpec();
    const sunken = (): number => spec.waterLevel - 0.5;
    expect(validateHole(spec, fakeTerrain(spec, sunken))?.check).toBe(6);
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

  it("always produces a dog-legged corridor of at least three control points", () => {
    const spec = generateHole(4242, 3);
    expect(spec.control.length).toBe(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[2]).toEqual(spec.cup);
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

  it("cycles the par mix for a course that is not nine holes", () => {
    expect(generateCourse(2026, 18).holes).toHaveLength(18);
    expect(parForIndex(9)).toBe(parForIndex(0));
  });
});
