import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { REFERENCE_CARRY_M } from "./carry";
import {
  MAX_ATTEMPTS,
  derivePar,
  generateCourse,
  generateHole,
  biomeForIndex,
  parForIndex,
} from "./course";
import type { BiomeId } from "./course";
import { validateHole } from "./holeValidation";
import { createTerrain } from "./terrain";

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
  it("gives fixedHoleSpec both fields", () => {
    const spec = fixedHoleSpec();
    expect(spec.biome).toBe(biomeForIndex(0));
    expect(Number.isFinite(spec.stripeAngle)).toBe(true);
  });
});

describe("parForIndex", () => {
  it("follows the course bible's card, front and back", () => {
    // docs/COURSE_PIPELINE.md section 4. Written out per hole rather than looped over the same
    // table the implementation reads -- a loop over that would pass by construction.
    const card = [5, 4, 4, 3, 4, 3, 4, 5, 4, 3, 4, 4, 4, 5, 4, 4, 3, 5];
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
