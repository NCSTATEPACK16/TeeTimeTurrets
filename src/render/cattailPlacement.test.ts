import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { SHEET_REACH_M, placeCattails } from "./cattailPlacement";
import { SHORE_STRIDE, buildWaterMesh } from "./waterMesh";

/**
 * Smoke check for the cattail fringe on the shipped course: every clump stands on the bank and
 * never in what the sim calls water, hugs a shoreline, and every pond that has a shore grows some.
 */
describe("cattails on the shipped course", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const heightAt = (x: number, z: number): number => world.terrain.heightAt(x, z);
  const water = buildWaterMesh(world.holes, heightAt, () => 0);
  const placed = placeCattails(water.shore, 2026, heightAt);

  it("finds a shoreline around the ponds", () => {
    expect(water.shore.length / SHORE_STRIDE).toBeGreaterThan(200);
    for (let i = 0; i < water.shore.length; i += SHORE_STRIDE) {
      expect(Math.hypot(water.shore[i + 2]!, water.shore[i + 3]!)).toBeCloseTo(1, 4);
    }
  });

  it("stands every clump above its pond's water, within 3 m of the shore", () => {
    expect(placed.length).toBeGreaterThan(80);
    for (const c of placed) {
      let nearest = Infinity;
      let level = -Infinity;
      for (let i = 0; i < water.shore.length; i += SHORE_STRIDE) {
        const d = Math.hypot(water.shore[i]! - c.x, water.shore[i + 1]! - c.z);
        nearest = Math.min(nearest, d);
        if (d <= SHEET_REACH_M) level = Math.max(level, water.shore[i + 4]!);
      }
      expect(heightAt(c.x, c.z)).toBeGreaterThanOrEqual(level);
      expect(nearest).toBeLessThan(3);
    }
  });

  it("grows in clusters with gaps, the same way every time", () => {
    const clusters = new Set(placed.map((c) => c.cluster)).size;
    expect(clusters).toBeGreaterThan(20);
    expect(placed.length / clusters).toBeGreaterThan(3);
    expect(placeCattails(water.shore, 2026, heightAt)).toEqual(placed);
  });
});
