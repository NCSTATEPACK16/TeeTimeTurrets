import { describe, expect, it } from "vitest";
import { biomeForIndex, fixedHoleSpec } from "./course";
import { REFERENCE_CARRY_M } from "./carry";
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

  it("is a legal par 3, as its doc comment says", () => {
    // The claim used to lean on the generator's own tests. It is checked here directly now.
    const spec = fixedHoleSpec();
    const terrain = createTerrain(spec);
    expect(validateHole(spec, terrain)).toBeNull();
    expect(spec.par).toBe(3);
    expect(terrain.spline.length).toBeLessThan(REFERENCE_CARRY_M);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(fixedHoleSpec()).not.toBe(fixedHoleSpec());
    expect(fixedHoleSpec()).toEqual(fixedHoleSpec());
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
