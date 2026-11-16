import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { SurfaceId } from "../sim/surfaceId";
import { placeCattails } from "./cattailPlacement";
import { buildWaterMesh } from "./waterMesh";

/**
 * Smoke check for the cattail fringe on the shipped course: every clump stands on the bank and
 * never in what the sim calls water, hugs a shoreline, and every pond that has a shore grows some.
 */
describe("cattails on the shipped course", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const isWater = (x: number, z: number): boolean => world.surfaces.surfaceAt(x, z) === SurfaceId.Water;
  const water = buildWaterMesh(world.holes, (x, z) => world.terrain.heightAt(x, z), isWater, () => 0);
  const placed = placeCattails(water.shore, 2026, isWater);

  it("finds a shoreline around the ponds", () => {
    expect(water.shore.length / 4).toBeGreaterThan(300);
    for (let i = 0; i < water.shore.length; i += 4) {
      expect(Math.hypot(water.shore[i + 2]!, water.shore[i + 3]!)).toBeCloseTo(1, 4);
    }
  });

  it("stands every clump on the bank, within 3 m of the shore", () => {
    expect(placed.length).toBeGreaterThan(120);
    for (const c of placed) {
      expect(isWater(c.x, c.z)).toBe(false);
      let nearest = Infinity;
      for (let i = 0; i < water.shore.length; i += 4) {
        nearest = Math.min(nearest, Math.hypot(water.shore[i]! - c.x, water.shore[i + 1]! - c.z));
      }
      expect(nearest).toBeLessThan(3);
    }
  });

  it("grows in clusters with gaps, the same way every time", () => {
    const clusters = new Set(placed.map((c) => c.cluster)).size;
    expect(clusters).toBeGreaterThan(25);
    expect(placed.length / clusters).toBeGreaterThan(3);
    expect(placeCattails(water.shore, 2026, isWater)).toEqual(placed);
  });
});
