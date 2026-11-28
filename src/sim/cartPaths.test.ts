import { beforeAll, describe, expect, it } from "vitest";
import { authoredCourse } from "./authoredCourse";
import { ZONE_HOLE_INDICES } from "./arenaZone";
import { PATH_HALF_WIDTH_M, pathHoles } from "./cartPaths";
import { buildCourseWorld } from "./courseWorld";
import type { CourseWorld } from "./courseWorld";
import { CART_TUNING, TIRE_TUNING, TireType } from "./entities/Cart";
import { cartSpeedScale } from "./mobility";
import { SURFACES, SurfaceId, createSurfaceTuning } from "./surfaces";

/** Cart paths on the shipped course (Stage 5 spec, §3). One course, built once. */
describe("cart paths", () => {
  let world: CourseWorld;
  beforeAll(() => {
    world = buildCourseWorld(authoredCourse(1), 1);
  }, 30_000);

  it("runs the course's loop: 18 holes and 20 links", () => {
    const names = world.cartPaths.map((p) => p.name);
    expect(names).toHaveLength(38);
    for (const name of ["h1", "h18", "c-t1", "g9-c", "c-t10", "g18-c", "g14-t15"]) expect(names).toContain(name);
  });

  it("keeps its paved width off water, sand, greens, tees and the bridge", () => {
    const refused = new Set([SurfaceId.Water, SurfaceId.Sand, SurfaceId.Green, SurfaceId.Tee, SurfaceId.Bridge]);
    let samples = 0;
    for (const path of world.cartPaths) {
      const pts = path.points;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k]!, az = pts[k + 1]!, bx = pts[k + 2]!, bz = pts[k + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len === 0) continue;
        // Across the paved width, every metre along it.
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (let s = 0; s < len; s += 1) {
          for (const off of [-PATH_HALF_WIDTH_M, 0, PATH_HALF_WIDTH_M]) {
            const x = ax + ((bx - ax) * s) / len + nx * off;
            const z = az + ((bz - az) * s) / len + nz * off;
            const surface = world.surfaces.surfaceAt(x, z);
            if (refused.has(surface)) expect.fail(`${path.name} crosses ${surface} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
            samples++;
          }
        }
      }
    }
    // A premise: about 10 km of path, three samples a metre.
    expect(samples).toBeGreaterThan(20_000);
  });

  it("reaches every arena tee", () => {
    const holes = pathHoles(world.holes);
    for (const index of ZONE_HOLE_INDICES) {
      const tee = holes[index]!.tee;
      let nearest = Infinity;
      for (const path of world.cartPaths) {
        for (let k = 0; k + 1 < path.points.length; k += 2) {
          nearest = Math.min(nearest, Math.hypot(path.points[k]! - tee.x, path.points[k + 1]! - tee.z));
        }
      }
      expect(nearest, `hole ${index + 1}'s tee`).toBeLessThan(20);
    }
  });

  it("is painted into the grids, and a street-tyre cart runs 1.18x its fairway speed on it", () => {
    const path = world.cartPaths.find((p) => p.name === "h1")!;
    const mid = (path.points.length >> 2) << 1;
    const x = path.points[mid]!;
    const z = path.points[mid + 1]!;
    const grids = world.grids;
    expect(grids.surfaces.surfaceAt(x, z)).toBe(SurfaceId.Path);
    const tuning = createSurfaceTuning();
    grids.surfaces.tuningAt(x, z, tuning);
    const street = TIRE_TUNING[TireType.Street];
    const onPath = cartSpeedScale(street, tuning.cartSpeedScale, CART_TUNING.minSurfaceScale);
    const onFairway = cartSpeedScale(street, SURFACES[SurfaceId.Fairway].cartSpeedScale, CART_TUNING.minSurfaceScale);
    expect(onPath / onFairway).toBeCloseTo(1 / 0.85, 6);
  });
});
