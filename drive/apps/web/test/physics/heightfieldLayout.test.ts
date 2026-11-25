import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { colToX, rowToZ } from '@gcs/level-schema';
import { HeightSampler } from '../../src/level/heightSampler';
import { createHeightfieldCollider } from '../../src/physics/heightfieldCollider';
import { createWorld, initRapier, type Rapier } from '../../src/physics/world';

let R: Rapier;
beforeAll(async () => {
  R = await initRapier();
});

function hitHeight(world: RAPIER.World, x: number, z: number): number | null {
  const hit = world.castRay(new R.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
  return hit ? 50 - hit.timeOfImpact : null;
}

describe('heightfield layout', () => {
  // 5 columns x 4 rows, deliberately non-square, one raised node at (row 1, col 3).
  const grid = { width: 5, height: 4, cellSize: 1 };
  const heights = new Float64Array(20);
  heights[1 * 5 + 3] = 2;

  it('puts the raised node where the packet says (no transpose, flip, off-by-one or offset)', () => {
    const world = createWorld(R);
    createHeightfieldCollider(R, world, grid, heights);
    world.step();
    const x = colToX(grid, 3);
    const z = rowToZ(grid, 1);
    // 5 cm north-west of the node (exact grid lines can miss in Rapier): upper triangle of
    // cell (0, 2), whose corner (1, 3) is the raised node: 2 - 2 * 0.05 - 2 * 0.05.
    expect(hitHeight(world, x - 0.05, z - 0.05)).toBeCloseTo(1.8, 4);
    // 5 cm south-east: lower triangle of cell (1, 3), same 1.8.
    expect(hitHeight(world, x + 0.05, z + 0.05)).toBeCloseTo(1.8, 4);
    // Where a transposed or flipped layout would put it, the field is flat.
    expect(hitHeight(world, colToX(grid, 1) + 0.05, rowToZ(grid, 3) + 0.05)).toBeCloseTo(0, 4);
    expect(hitHeight(world, colToX(grid, 3) - 0.05, rowToZ(grid, 2) + 0.05)).toBeCloseTo(0, 4);
    expect(hitHeight(world, colToX(grid, 1) + 0.05, rowToZ(grid, 1) + 0.05)).toBeCloseTo(0, 4);
    // The field spans exactly the grid: inside at the corners, nothing beyond.
    expect(hitHeight(world, colToX(grid, 0) + 0.01, rowToZ(grid, 0) + 0.01)).not.toBeNull();
    expect(hitHeight(world, colToX(grid, 4) - 0.01, rowToZ(grid, 3) - 0.01)).not.toBeNull();
    expect(hitHeight(world, colToX(grid, 4) + 0.2, 0.3)).toBeNull();
    expect(hitHeight(world, 0.3, rowToZ(grid, 0) - 0.2)).toBeNull();
  });

  it('triangulates every cell the same way as HeightSampler', () => {
    const g = { width: 4, height: 4, cellSize: 1 };
    const sampler = new HeightSampler(g, new Float64Array(16));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const h = new Float64Array(16);
        h[r * 4 + c] = 1;
        const world = createWorld(R);
        createHeightfieldCollider(R, world, g, h);
        world.step();
        const s = new HeightSampler(g, h);
        for (const [u, v] of [
          [0.25, 0.25],
          [0.75, 0.75],
          [0.3, 0.6],
          [0.6, 0.3],
        ] as const) {
          const x = colToX(g, c + u);
          const z = rowToZ(g, r + v);
          expect(hitHeight(world, x, z)).toBeCloseTo(s.heightAt(x, z), 5);
        }
      }
    }
    expect(sampler.heightAt(0, 0)).toBe(0);
  });
});
