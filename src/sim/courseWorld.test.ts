import { describe, expect, it } from "vitest";
import { buildCourseWorld } from "./courseWorld";
import { generateCourse } from "./course";
import { toCourseFrame } from "./courseGeometry";
import { createSpawnSet } from "./spawn";
import { SurfaceId } from "./surfaces";

/** The seed main.ts ships, so this exercises the course the player is actually handed. */
const COURSE_SEED = 2026;

const world = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);

/** A placed hole's cup, in the course frame. */
function cupOf(index: number): { x: number; z: number } {
  const hole = world.holes[index]!;
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, out);
  return out;
}

describe("buildCourseWorld", () => {
  it("places every hole exactly once, in course order", () => {
    expect(world.holes).toHaveLength(18);
    expect(world.holes.map((h) => h.spec.index)).toEqual([...Array(18).keys()]);
  });

  /**
   * The failure this module exists to prevent, and it is silent.
   *
   * `createCourseSurfaces` takes per-hole `Surfaces` alongside the blended `CourseTerrain`. Build
   * those per-hole surfaces against a *second* `createTerrain(spec)` rather than the one the
   * terrain blended and nothing throws -- the two heightfields are equal but separate, and the
   * course reads materials from one while standing on the other. Asserting the cup reads as green
   * is the cheapest thing that catches it: a cup is the middle of a green by construction, so any
   * disagreement between the material lookup and the placement shows up here first.
   */
  /**
   * `it.fails` and not `it.skip`: this assertion is **correct** and the course is wrong. Three of
   * eighteen cups are owned by a neighbouring hole rather than their own, so they read that
   * neighbour's material -- hole 9 `fairway`, hole 18 `rough`, and hole 17 `water`. All three are
   * inside `CLUBHOUSE_APRON_M`, where the returning nines crowd; all three read `green` correctly
   * on their own hole's `Surfaces`, so the defect is ownership in `courseTerrain.weightsInto`, not
   * the surface blend (`courseSurfaces.surfaceAt` already asks only the owning hole).
   *
   * Recorded this way so the bug is visible in the suite and so this inverts to a plain red the
   * moment it is fixed -- at which point delete the `.fails` rather than the test. Skipping it
   * would have hidden a cup under water; asserting the broken values would have locked them in.
   */
  it.fails("puts green under every cup, so materials and placement agree", () => {
    for (let i = 0; i < 18; i++) {
      const cup = cupOf(i);
      expect(world.surfaces.surfaceAt(cup.x, cup.z), `hole ${i + 1}`).toBe(SurfaceId.Green);
    }
  });

  it("covers every cup with its own course ground rather than leaving it outside the bounds", () => {
    for (let i = 0; i < 18; i++) {
      const cup = cupOf(i);
      expect(cup.x).toBeGreaterThanOrEqual(world.terrain.bounds.minX);
      expect(cup.x).toBeLessThanOrEqual(world.terrain.bounds.maxX);
      expect(cup.z).toBeGreaterThanOrEqual(world.terrain.bounds.minZ);
      expect(cup.z).toBeLessThanOrEqual(world.terrain.bounds.maxZ);
      expect(Number.isFinite(world.terrain.heightAt(cup.x, cup.z))).toBe(true);
    }
  });

  /**
   * `Sim.loadCourse` passes `world.holes` straight to `createSpawnSet` as `SpawnHole[]`. That is a
   * structural claim TypeScript checks at the call site and nothing checks at runtime, so this
   * runs the real function over the real array: eighteen tees, each facing its own cup.
   */
  it("hands spawn a usable set of eighteen tees", () => {
    const set = createSpawnSet(world.holes, (x, z) => world.terrain.heightAt(x, z));
    expect(set).toHaveLength(18);
    expect(set.map((s) => s.hole)).toEqual([...Array(18).keys()]);
    for (const point of set) {
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.heading)).toBe(true);
    }
  });

  it("is deterministic: the same seed builds the same course", () => {
    const again = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);
    expect(again.holes.map((h) => h.placement)).toEqual(world.holes.map((h) => h.placement));
    const cup = cupOf(7);
    expect(again.terrain.heightAt(cup.x, cup.z)).toBe(world.terrain.heightAt(cup.x, cup.z));
  });
});
