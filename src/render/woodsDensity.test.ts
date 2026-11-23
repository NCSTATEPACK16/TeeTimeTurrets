import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { AUTHORED_CLUBHOUSE } from "../sim/authoredLayout";
import { toCourseFrame } from "../sim/courseLayout";
import { buildCourseWorld } from "../sim/courseWorld";
import { createSpline } from "../sim/spline";
import { SurfaceId } from "../sim/surfaceId";
import { GROUND_EDGES } from "./groundShader";
import { buildWoodsDensity, placeCourseWoods, woodsDensityAt } from "./woodsPlacement";

/**
 * Smoke check for the woods floor (the Caswell spec, D7) on the shipped course: the density the
 * ground draws pine straw from is high under every tree and nothing on the mown ground.
 */
describe("woods density", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const trees = placeCourseWoods(world.terrain, world.surfaces, {
    seed: 2026,
    southBoundary: world.southBoundary,
    clubhouse: AUTHORED_CLUBHOUSE,
  });
  const field = buildWoodsDensity(trees, world.terrain.bounds);

  it("is high under every tree", () => {
    let lowest = Infinity;
    for (const t of trees) lowest = Math.min(lowest, woodsDensityAt(field, t.x, t.z));
    expect(lowest).toBeGreaterThan(0.7);
  });

  it("is nothing along any fairway's centreline", () => {
    const p = { x: 0, z: 0 };
    let worst = 0;
    let samples = 0;
    for (const hole of world.terrain.holes) {
      const spline = createSpline(hole.spec.control);
      // The tee and green ends are the green and the tee box; the stretch between is fairway.
      for (let t = 0.15; t <= 0.85; t += 0.01) {
        const q = spline.pointAt(t);
        toCourseFrame(hole.placement, q.x, q.z, p);
        if (world.surfaces.surfaceAt(p.x, p.z) !== SurfaceId.Fairway) continue;
        worst = Math.max(worst, woodsDensityAt(field, p.x, p.z));
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(500);
    expect(worst).toBe(0);
  });

  it("stays below anything straw can show on every green", () => {
    // A green's back edge can sit a few metres from a clump, and the 4 m grid blurs a little onto
    // it. What matters is that no straw is drawn: the density, plus the most the edge noise can
    // add, stays under the threshold where straw starts.
    let worst = 0;
    let samples = 0;
    const { bounds } = world.terrain;
    for (let z = bounds.minZ; z < bounds.maxZ; z += 3) {
      for (let x = bounds.minX; x < bounds.maxX; x += 3) {
        if (world.surfaces.surfaceAt(x, z) !== SurfaceId.Green) continue;
        worst = Math.max(worst, woodsDensityAt(field, x, z));
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(500);
    expect(worst + GROUND_EDGES.strawNoise).toBeLessThan(GROUND_EDGES.strawFrom);
  });

  it("covers a modest share of the course", () => {
    let sum = 0;
    for (const v of field.values) sum += v;
    const mean = sum / field.values.length;
    expect(mean).toBeGreaterThan(0.03);
    expect(mean).toBeLessThan(0.25);
  });
});
