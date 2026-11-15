import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { SurfaceId } from "../sim/surfaceId";
import { RIPPLE_LIFE_S, RIPPLE_SLOTS, RippleRing, buildWaterMesh } from "./waterMesh";

/**
 * Smoke check for the Stage 3.5b water surface: on the shipped course, every placed pond gets a
 * sheet at its hole's water level, it shows only where the sim's own surfaces say water, and the
 * baked depth both reaches the shore (where the foam goes) and reaches deep water (where the
 * colour goes dark). A sheet with no shallow vertices
 * would draw no foam; one with no deep ones would be a puddle of foam.
 */
describe("water mesh on the shipped course", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const placedPonds = world.holes.reduce((n, hole) => n + hole.spec.water.length, 0);
  const mesh = buildWaterMesh(
    world.holes,
    (x, z) => world.terrain.heightAt(x, z),
    (x, z) => world.surfaces.surfaceAt(x, z) === SurfaceId.Water,
    () => 0x4a91aa,
  );

  it("draws every placed pond at its water level", () => {
    expect(placedPonds).toBeGreaterThan(0);
    expect(mesh.ponds).toBe(placedPonds);
    const levels = new Set(world.holes.map((hole) => Math.fround(hole.spec.waterLevel)));
    for (let i = 1; i < mesh.positions.length; i += 3) expect(levels.has(mesh.positions[i]!)).toBe(true);
  });

  it("never draws water over ground the sim does not call water", () => {
    // Hole 18's pond polygon holds fairway the course blend gave to another hole, below the
    // water level. Water drawn there is water a cart drives through dry.
    let wrong = 0;
    for (let v = 0; v < mesh.depth.length; v++) {
      if (mesh.depth[v]! <= 0) continue;
      const x = mesh.positions[v * 3]!;
      const z = mesh.positions[v * 3 + 2]!;
      if (world.surfaces.surfaceAt(x, z) !== SurfaceId.Water) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("bakes a shore and deep water into the depth", () => {
    let shore = 0;
    let deep = 0;
    for (const d of mesh.depth) {
      if (d > 0 && d < 0.25) shore++;
      if (d > 1.2) deep++;
    }
    expect(shore).toBeGreaterThan(50);
    expect(deep).toBeGreaterThan(50);
  });
});

describe("ripple ring", () => {
  it("keeps the last eight splashes and lets them expire", () => {
    const ring = new RippleRing();
    for (let i = 0; i < RIPPLE_SLOTS + 3; i++) ring.push(i, 0, 0);
    expect(ring.live(0.1)).toBe(RIPPLE_SLOTS);
    // The three oldest were overwritten by the three newest.
    expect(ring.data[0]).toBe(RIPPLE_SLOTS);
    expect(ring.live(RIPPLE_LIFE_S + 0.01)).toBe(0);
  });
});
