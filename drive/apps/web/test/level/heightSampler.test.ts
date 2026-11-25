import { describe, expect, it } from 'vitest';
import { colToX, rowToZ } from '@gcs/level-schema';
import { HeightSampler } from '../../src/level/heightSampler';

// 4 columns x 3 rows. Row 0 is the north edge (most negative z).
const grid = { width: 4, height: 3, cellSize: 1 };
const heights = Float64Array.from([
  0, 1, 2, 3, // row 0 (north)
  10, 11, 12, 13, // row 1
  20, 21, 22, 23, // row 2 (south)
]);
const s = new HeightSampler(grid, heights);

describe('HeightSampler', () => {
  it('is exact at every node and puts row 0 at the north (-Z) edge', () => {
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        expect(s.heightAt(colToX(grid, c), rowToZ(grid, r))).toBeCloseTo(heights[r * 4 + c]!, 12);
      }
    }
    expect(s.heightAt(colToX(grid, 0), -1)).toBe(0); // north-west corner
    expect(s.heightAt(colToX(grid, 0), 1)).toBe(20); // south-west corner
  });

  it('is linear along cell edges', () => {
    const z0 = rowToZ(grid, 0);
    expect(s.heightAt(colToX(grid, 0.25), z0)).toBeCloseTo(0.25, 12);
    expect(s.heightAt(colToX(grid, 1), rowToZ(grid, 0.5))).toBeCloseTo(6, 12);
  });

  it('splits cells along the (row, col+1)-(row+1, col) diagonal', () => {
    // One raised node at (row 0, col 0): only the triangle u + v <= 1 of cell (0, 0) sees it.
    const g = { width: 2, height: 2, cellSize: 1 };
    const one = new HeightSampler(g, Float64Array.from([1, 0, 0, 0]));
    const at = (u: number, v: number) => one.heightAt(colToX(g, u), rowToZ(g, v));
    expect(at(0.25, 0.25)).toBeCloseTo(0.5, 12);
    expect(at(0.75, 0.75)).toBeCloseTo(0, 12);
    expect(at(0.5, 0.5)).toBeCloseTo(0, 12); // on the diagonal
  });

  it('clamps outside the grid', () => {
    expect(s.heightAt(-100, -100)).toBe(0);
    expect(s.heightAt(100, 100)).toBe(23);
  });

  it('returns upward unit normals that follow the slope', () => {
    const n = s.normalAt(0.1, 0.1);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
    expect(n.y).toBeGreaterThan(0);
    // Heights rise toward +x (1 per m) and +z (10 per m): the normal leans to -x and -z.
    expect(n.x).toBeLessThan(0);
    expect(n.z).toBeLessThan(n.x);
  });
});
