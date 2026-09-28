import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { REFERENCE_CARRY_M } from "./carry";
import { briefForHole } from "./briefs";
import { SurfaceId, createSurfaceWeights, createSurfaces } from "./surfaces";
import {
  MAX_ATTEMPTS,
  derivePar,
  generateCourse,
  generateHole,
  STRIPE_JITTER,
  biomeForIndex,
  parForIndex,
} from "./course";
import type { BiomeId } from "./course";
import { validateHole } from "./holeValidation";
import { WOODS_WEIGHT, createTerrain } from "./terrain";

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
    // Hole 4 is the forced carry over the north-east pond; hole 1 is the opener along the road,
    // with no water at all. Both were different holes before the briefs were re-authored against
    // the real card -- the carry used to be hole 2.
    expect(generateHole(4242, 3).water.length).toBeGreaterThan(0);
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
    // Hole 12's brief has no bunkers -- under the old noise scatter it had sand anyway. Read the
    // count back first, so this fails loudly if the brief gains one rather than silently passing
    // on a hole that no longer makes the point.
    expect(briefForHole(12).hazards.bunkers.count).toBe(0);
    expect(generateHole(4242, 11).bunkers).toEqual([]);
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
