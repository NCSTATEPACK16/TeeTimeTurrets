import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { AUTHORED_CLUBHOUSE } from "../sim/authoredLayout";
import { toCourseFrame } from "../sim/courseLayout";
import { buildCourseWorld } from "../sim/courseWorld";
import { createSpline } from "../sim/spline";
import { SurfaceId } from "../sim/surfaceId";
import { createSurfaceWeights } from "../sim/surfaces";
import {
  CELL_M,
  RING_SIZE,
  TUFT_STRIDE,
  cellOf,
  createCourseTuftQuery,
  fillCell,
  ringCells,
  tuftsPerCell,
} from "./grassCells";
import { GROUND_EDGES } from "./groundShader";
import { groundWarp } from "./groundWarp";
import { buildWoodsDensity, placeCourseWoods, woodsDensityAt } from "./woodsPlacement";

/**
 * Smoke check for the grass tufts on the shipped course: none on a fairway, most of a rough cell
 * grown, every tuft on rough and dry, the same cell the same twice, and the ring the right size.
 */
describe("grass cells", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const trees = placeCourseWoods(world.terrain, world.surfaces, {
    seed: 2026,
    southBoundary: world.southBoundary,
    clubhouse: AUTHORED_CLUBHOUSE,
  });
  const woods = buildWoodsDensity(trees, world.terrain.bounds);
  const query = createCourseTuftQuery(world.terrain, world.surfaces, woods, 2026);
  const density = 1.5;
  const out = new Float32Array(tuftsPerCell(density) * TUFT_STRIDE);
  const weights = createSurfaceWeights();

  /** Every probe point of a cell (a 7 x 7 grid) passes `test`. */
  const wholeCell = (cx: number, cz: number, test: (x: number, z: number) => boolean): boolean => {
    for (let i = 0; i <= 6; i++) {
      for (let j = 0; j <= 6; j++) {
        if (!test(cx * CELL_M + (i / 6) * CELL_M, cz * CELL_M + (j / 6) * CELL_M)) return false;
      }
    }
    return true;
  };

  // Hole 1's centreline, in the course frame, to find a cell on its fairway and one in its rough.
  const hole = world.terrain.holes[0]!;
  const spline = createSpline(hole.spec.control);
  const along: { x: number; z: number }[] = [];
  for (let t = 0.2; t <= 0.8; t += 0.02) {
    const q = spline.pointAt(t);
    const p = { x: 0, z: 0 };
    toCourseFrame(hole.placement, q.x, q.z, p);
    along.push(p);
  }

  const fairwayCell = (() => {
    for (const p of along) {
      const cx = cellOf(p.x);
      const cz = cellOf(p.z);
      if (wholeCell(cx, cz, (x, z) => world.surfaces.surfaceAt(x, z) === SurfaceId.Fairway)) return [cx, cz] as const;
    }
    throw new Error("no all-fairway cell on hole 1");
  })();

  const roughCell = (() => {
    const rough = (x: number, z: number): boolean => {
      if (world.surfaces.surfaceAt(x, z) !== SurfaceId.Rough) return false;
      world.surfaces.weightsAt(x, z, weights);
      return weights.corridor > 0.9 && weights.sand === 0 && weights.water === 0 && woodsDensityAt(woods, x, z) < 0.05;
    };
    for (const p of along) {
      for (let r = 2; r <= 6; r++) {
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
          const cx = cellOf(p.x) + dx;
          const cz = cellOf(p.z) + dz;
          if (wholeCell(cx, cz, rough)) return [cx, cz] as const;
        }
      }
    }
    throw new Error("no open-rough cell beside hole 1");
  })();

  it("grows nothing on the fairway", () => {
    expect(fillCell(fairwayCell[0], fairwayCell[1], density, query, out)).toBe(0);
  });

  it("grows most of a rough cell, every tuft on dry rough", () => {
    const n = fillCell(roughCell[0], roughCell[1], density, query, out);
    expect(n).toBeGreaterThanOrEqual(0.4 * density * CELL_M * CELL_M);
    expect(n).toBeLessThanOrEqual(tuftsPerCell(density));
    for (let i = 0; i < n; i++) {
      const x = out[i * TUFT_STRIDE]!;
      const z = out[i * TUFT_STRIDE + 2]!;
      expect(world.surfaces.surfaceAt(x, z)).toBe(SurfaceId.Rough);
      world.surfaces.weightsAt(x, z, weights);
      expect(weights.water).toBe(0);
      expect(out[i * TUFT_STRIDE + 1]).toBeCloseTo(world.terrain.heightAt(x, z), 5);
    }
  });

  it("never stands on what the ground draws as fairway, along every edge of hole 1", () => {
    // The sim's rough and the drawn fairway edge are different lines: the shader reads the
    // corridor weight through the edge warp. A tuft must agree with the drawn one.
    const warp = { x: 0, z: 0 };
    const seen = new Set<string>();
    let tufts = 0;
    let worst = 1;
    for (const p of along) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const cx = cellOf(p.x) + dx;
          const cz = cellOf(p.z) + dz;
          if (seen.has(`${cx},${cz}`)) continue;
          seen.add(`${cx},${cz}`);
          const n = fillCell(cx, cz, density, query, out);
          for (let i = 0; i < n; i++) {
            const x = out[i * TUFT_STRIDE]!;
            const z = out[i * TUFT_STRIDE + 2]!;
            groundWarp(x, z, warp);
            world.surfaces.weightsAt(x + warp.x, z + warp.z, weights);
            worst = Math.min(worst, weights.corridor);
            tufts++;
          }
        }
      }
    }
    expect(tufts).toBeGreaterThan(1000);
    expect(worst).toBeGreaterThan(GROUND_EDGES.firstCutFrom + GROUND_EDGES.cutSoftness);
  });

  it("grows the same cell the same way twice, into the same buffer", () => {
    const n = fillCell(roughCell[0], roughCell[1], density, query, out);
    const first = out.slice(0, n * TUFT_STRIDE);
    const buffer = out.buffer;
    for (let i = 0; i < 200; i++) fillCell(roughCell[0] + (i % 3), roughCell[1], density, query, out);
    expect(fillCell(roughCell[0], roughCell[1], density, query, out)).toBe(n);
    expect(out.slice(0, n * TUFT_STRIDE)).toEqual(first);
    expect(out.buffer).toBe(buffer);
    expect(out.length).toBe(tuftsPerCell(density) * TUFT_STRIDE);
  });

  it("rings the camera with 69 cells or fewer, its own first", () => {
    const cells = new Int32Array(RING_SIZE * 2);
    const n = ringCells(130.5, -47.2, cells);
    expect(n).toBeLessThanOrEqual(69);
    expect(n).toBeGreaterThan(40);
    expect([cells[0], cells[1]]).toEqual([cellOf(130.5), cellOf(-47.2)]);
  });
});
