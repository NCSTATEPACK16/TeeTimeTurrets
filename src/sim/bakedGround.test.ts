import { describe, expect, it } from "vitest";
import { SurfaceId, createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, SurfaceWeights, Surfaces } from "./surfaces";
import { BakedSurfaces, bakeHeightGrid, gridHeightAt } from "./bakedGround";

const BOUNDS = { minX: -10, minZ: -6, maxX: 30, maxZ: 14 };

describe("bakeHeightGrid / gridHeightAt", () => {
  it("returns the sampled height exactly at a sample, in Rapier's column-major order", () => {
    const grid = bakeHeightGrid(BOUNDS, 2, (x, z) => x * 10 + z);
    expect(grid.cols).toBe(20);
    expect(grid.rows).toBe(10);
    // Column-major: row (Z) runs fastest.
    expect(grid.heights[1]).toBe(-10 * 10 + -4);
    expect(gridHeightAt(grid, 4, 2)).toBeCloseTo(4 * 10 + 2, 9);
  });

  it("is exact for any plane, which bilinear interpolation reproduces", () => {
    const plane = (x: number, z: number) => 0.3 * x - 0.7 * z + 5;
    const grid = bakeHeightGrid(BOUNDS, 2, plane);
    for (const [x, z] of [[0.5, 0.5], [13.3, -2.9], [29.1, 13.7]] as const) {
      expect(gridHeightAt(grid, x, z)).toBeCloseTo(plane(x, z), 5);
    }
  });

  it("interpolates between samples rather than stepping", () => {
    const grid = bakeHeightGrid(BOUNDS, 2, (x, z) => (x === 0 && z === 0 ? 4 : 0));
    expect(gridHeightAt(grid, 0, 0)).toBe(4);
    expect(gridHeightAt(grid, 1, 0)).toBeCloseTo(2, 9);
    expect(gridHeightAt(grid, 1, 1)).toBeCloseTo(1, 9);
  });

  it("holds the edge value past the box instead of reading out of the array", () => {
    const grid = bakeHeightGrid(BOUNDS, 2, (x) => x);
    expect(gridHeightAt(grid, -500, 0)).toBe(-10);
    expect(gridHeightAt(grid, 500, 0)).toBe(30);
  });
});

/** A synthetic course: water west of x = 0, sand in a strip, fairway elsewhere; tuning varies in x. */
function countingSource(): Surfaces & { calls: number } {
  const source = {
    calls: 0,
    surfaceAt(x: number, z: number): SurfaceId {
      source.calls++;
      if (x < 0) return SurfaceId.Water;
      if (z > 10) return SurfaceId.Sand;
      return SurfaceId.Fairway;
    },
    tuningAt(x: number, _z: number, out: MutableSurfaceTuning): void {
      source.calls++;
      out.rolling = 0.1 + x * 0.01;
      out.bounceScale = 0.5;
      out.cartSpeedScale = 1 - Math.max(0, x) * 0.01;
      out.isHazard = x < 0;
    },
    weightsAt(_x: number, _z: number, _out: SurfaceWeights): void {},
  };
  return source;
}

describe("BakedSurfaces", () => {
  it("answers each surface query with the source's value at the nearest sample", () => {
    const baked = new BakedSurfaces(countingSource(), BOUNDS, 2);
    expect(baked.surfaceAt(-3.1, 0)).toBe(SurfaceId.Water);
    expect(baked.surfaceAt(5, 0)).toBe(SurfaceId.Fairway);
    expect(baked.surfaceAt(5, 12.2)).toBe(SurfaceId.Sand);
  });

  it("interpolates the tuning, and takes the hazard flag from the nearest sample", () => {
    const baked = new BakedSurfaces(countingSource(), BOUNDS, 2);
    const out = createSurfaceTuning();
    baked.tuningAt(7, 1, out);
    expect(out.rolling).toBeCloseTo(0.17, 9);
    expect(out.cartSpeedScale).toBeCloseTo(0.93, 9);
    expect(out.isHazard).toBe(false);
    baked.tuningAt(-3, 1, out);
    expect(out.isHazard).toBe(true);
  });

  it("bakes a tile the first time it is touched and never again", () => {
    const source = countingSource();
    const baked = new BakedSurfaces(source, BOUNDS, 2, 4);
    expect(baked.tilesBaked).toBe(0);
    baked.surfaceAt(1, 1);
    expect(baked.tilesBaked).toBe(1);
    const afterFirst = source.calls;
    // Both inside the same 4-node tile as the first query: nodes 4..7 on each axis.
    baked.surfaceAt(2.2, 1.9);
    baked.tuningAt(0.5, 3.5, createSurfaceTuning());
    expect(baked.tilesBaked).toBe(1);
    expect(source.calls).toBe(afterFirst);
    baked.surfaceAt(25, 12);
    expect(baked.tilesBaked).toBe(2);
  });

  it("gives the same answer whichever tile was baked first", () => {
    const a = new BakedSurfaces(countingSource(), BOUNDS, 2, 4);
    const b = new BakedSurfaces(countingSource(), BOUNDS, 2, 4);
    const out = createSurfaceTuning();
    a.surfaceAt(25, 12);
    a.tuningAt(7.3, 3.3, out);
    const fromA = out.rolling;
    b.tuningAt(7.3, 3.3, out);
    expect(out.rolling).toBe(fromA);
  });
});
