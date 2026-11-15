import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { AUTHORED_CLUBHOUSE } from "../sim/authoredLayout";
import { buildCourseWorld } from "../sim/courseWorld";
import { SurfaceId } from "../sim/surfaceId";
import { CLUBHOUSE_CLEAR_M, MIN_SPACING_M, clumpOrder, placeCourseWoods } from "./woodsPlacement";

/**
 * Smoke check for the Stage 3.5b woods on the shipped course: trees stand in clumps, only on
 * rough, never closer than the spacing, and a quality cap drops whole clumps spread over the
 * course rather than one end of it.
 */
describe("course woods placement", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const options = { seed: 2026, southBoundary: world.southBoundary, clubhouse: AUTHORED_CLUBHOUSE };
  const trees = placeCourseWoods(world.terrain, world.surfaces, options);

  it("plants only on rough, clear of the clubhouse", () => {
    expect(trees.length).toBeGreaterThan(1200);
    for (const t of trees) {
      expect(world.surfaces.surfaceAt(t.x, t.z)).toBe(SurfaceId.Rough);
      expect(Math.hypot(t.x - AUTHORED_CLUBHOUSE.x, t.z - AUTHORED_CLUBHOUSE.z)).toBeGreaterThanOrEqual(CLUBHOUSE_CLEAR_M);
    }
  });

  it("keeps every pair of trunks at least the spacing apart", () => {
    let closest = Infinity;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z);
        if (d < closest) closest = d;
      }
    }
    expect(closest).toBeGreaterThanOrEqual(MIN_SPACING_M);
  });

  it("groups them in clumps, most of three trees or more", () => {
    const sizes = new Map<number, number>();
    for (const t of trees) sizes.set(t.clump, (sizes.get(t.clump) ?? 0) + 1);
    const counts = [...sizes.values()];
    const grouped = counts.filter((n) => n >= 3).length;
    expect(grouped / counts.length).toBeGreaterThan(0.7);
    expect(Math.max(...counts)).toBeLessThanOrEqual(11);
  });

  it("is the same wood on the same seed", () => {
    const again = placeCourseWoods(world.terrain, world.surfaces, options);
    expect(again).toEqual(trees);
  });

  it("orders clumps so a cap keeps both ends of the course", () => {
    const ordered = clumpOrder(trees, 2026);
    expect(ordered.length).toBe(trees.length);
    const kept = ordered.slice(0, Math.floor(ordered.length * 0.4));
    const midZ = (world.terrain.bounds.minZ + world.terrain.bounds.maxZ) / 2;
    const north = kept.filter((t) => t.z > midZ).length;
    const allNorth = trees.filter((t) => t.z > midZ).length / trees.length;
    // Within ten points of the uncapped split, where row-major order kept none of one half.
    expect(Math.abs(north / kept.length - allNorth)).toBeLessThan(0.1);
  });
});
