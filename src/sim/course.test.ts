import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { authoredCourse } from "./authoredCourse";
import { SurfaceId, createSurfaceWeights, createSurfaces } from "./surfaces";
import { STRIPE_JITTER, biomeForIndex } from "./course";
import type { BiomeId } from "./course";
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

describe("the authored course's surfaces", () => {
  it("never puts sand in the woods", () => {
    // Sand belongs to the fairway and the first cut beside it. A bunker out among the trees is
    // not a hazard anybody plays around -- it is a sand patch in a forest, and it was the last
    // thing left over from the noise-scatter era's geography.
    //
    // "The woods" is not a new idea invented here: it is exactly where `Trees.ts` plants, which
    // is `corridorWeight >= WOODS_WEIGHT`. Asserting against that constant rather than a distance
    // means sand and trees can never end up in the same place by construction, on any corridor
    // width, and the two cannot drift apart later.
    const course = authoredCourse(0x7ee7c0);
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
  it("puts the bible's biome on every hole of the authored course", () => {
    const course = authoredCourse(0x51de);
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
    const course = authoredCourse(0x51de);
    for (const hole of course.holes) {
      const bearing = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
      expect(angularDelta(hole.stripeAngle, bearing)).toBeLessThanOrEqual(STRIPE_JITTER + 1e-9);
    }
  });

  it("varies the stripe angle between holes rather than pinning it to the bearing", () => {
    const course = authoredCourse(0x51de);
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
    const a = authoredCourse(0x51de);
    const b = authoredCourse(0x51de);
    for (let i = 0; i < 18; i++) {
      expect(a.holes[i]!.stripeAngle).toBe(b.holes[i]!.stripeAngle);
      expect(a.holes[i]!.biome).toBe(b.holes[i]!.biome);
    }
    const other = authoredCourse(0x51df);
    expect(other.holes[0]!.stripeAngle).not.toBe(a.holes[0]!.stripeAngle);
  });
});
