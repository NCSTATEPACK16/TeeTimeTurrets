import { describe, expect, it } from 'vitest';
import { MaterialId, colToX, rowToZ } from '@gcs/level-schema';
import { SurfaceSampler } from '../../src/level/surfaceSampler';

// Asymmetric 4 x 4 grid: north-west bunker, north-east cartpath, south-west fairway,
// south-east green, plus one water node at (row 0, col 3) to catch transposition.
const B = MaterialId.bunker;
const P = MaterialId.cartpath;
const F = MaterialId.fairway;
const G = MaterialId.green;
const W = MaterialId.water;
const grid = { width: 4, height: 4, cellSize: 1 };
const material = Uint8Array.from([
  B, B, P, W,
  B, B, P, P,
  F, F, G, G,
  F, F, G, G,
]);
const s = new SurfaceSampler(grid, material);

describe('SurfaceSampler', () => {
  it('reads quadrants with row 0 at the north (-Z) edge and no transposition', () => {
    expect(s.materialAt(colToX(grid, 0), rowToZ(grid, 0))).toBe('bunker');
    expect(s.materialAt(colToX(grid, 2), rowToZ(grid, 1))).toBe('cartpath');
    expect(s.materialAt(colToX(grid, 1), rowToZ(grid, 3))).toBe('fairway');
    expect(s.materialAt(colToX(grid, 3), rowToZ(grid, 3))).toBe('green');
    expect(s.materialAt(colToX(grid, 3), rowToZ(grid, 0))).toBe('water');
    expect(s.materialAt(colToX(grid, 0), rowToZ(grid, 3))).toBe('fairway');
  });

  it('uses the nearest node', () => {
    expect(s.materialAt(colToX(grid, 1.49), rowToZ(grid, 0))).toBe('bunker');
    expect(s.materialAt(colToX(grid, 1.51), rowToZ(grid, 0))).toBe('cartpath');
    expect(s.materialAt(colToX(grid, 2.6), rowToZ(grid, 0.4))).toBe('water');
    expect(s.materialAt(colToX(grid, 2.6), rowToZ(grid, 0.6))).toBe('cartpath');
  });

  it('reads rough outside the grid', () => {
    expect(s.materialAt(-50, 0)).toBe('rough');
    expect(s.materialAt(0, 50)).toBe('rough');
    expect(s.materialIdAt(colToX(grid, -0.6), rowToZ(grid, 0))).toBe(MaterialId.rough);
  });
});
