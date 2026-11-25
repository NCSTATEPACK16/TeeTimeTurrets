/**
 * M0 gate: "Raycast parity: collider within 1 cm of the CPU height sampler at 200 points".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { colToX, rowToZ } from '@gcs/level-schema';
import type { Level } from '../../src/level/loadLevel';
import { HeightSampler } from '../../src/level/heightSampler';
import { createHeightfieldCollider } from '../../src/physics/heightfieldCollider';
import { createWorld, initRapier, type Rapier } from '../../src/physics/world';
import { LEVEL_ID, loadTestLevel, mulberry32 } from '../helpers/packet';

const TOLERANCE_M = 0.01;
const RANDOM_POINTS = 180;
const STEEP_CELLS = 10; // two points each

let R: Rapier;
let level: Level;
beforeAll(async () => {
  [R, level] = await Promise.all([initRapier(), loadTestLevel()]);
});

/** The steepest cells by the larger of their two triangle slopes. */
function steepestCells(level: Level, count: number): { row: number; col: number }[] {
  const { width, height } = level.grid;
  const h = level.heights;
  const cells: { row: number; col: number; slope: number }[] = [];
  for (let r = 0; r < height - 1; r++) {
    for (let c = 0; c < width - 1; c++) {
      const h00 = h[r * width + c]!;
      const h01 = h[r * width + c + 1]!;
      const h10 = h[(r + 1) * width + c]!;
      const h11 = h[(r + 1) * width + c + 1]!;
      const slope = Math.max(Math.hypot(h01 - h00, h10 - h00), Math.hypot(h11 - h10, h11 - h01));
      cells.push({ row: r, col: c, slope });
    }
  }
  cells.sort((a, b) => b.slope - a.slope);
  // Spread them out: skip cells within 3 nodes of one already picked.
  const picked: { row: number; col: number }[] = [];
  for (const cell of cells) {
    if (picked.every((p) => Math.abs(p.row - cell.row) > 3 || Math.abs(p.col - cell.col) > 3)) picked.push(cell);
    if (picked.length === count) break;
  }
  return picked;
}

describe(`heightfield parity (${LEVEL_ID})`, () => {
  it('Rapier ray hits match HeightSampler within 1 cm at 200 points', () => {
    const world = createWorld(R);
    createHeightfieldCollider(R, world, level.grid, level.heights);
    world.step();
    const sampler = new HeightSampler(level.grid, level.heights);
    const { width, height } = level.grid;
    const top = level.maxHeight + 10;

    const points: { x: number; z: number; kind: string }[] = [];
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < RANDOM_POINTS; i++) {
      // Random positions never land exactly on a grid line in practice.
      points.push({ x: colToX(level.grid, 0.5 + rand() * (width - 2)), z: rowToZ(level.grid, 0.5 + rand() * (height - 2)), kind: 'random' });
    }
    for (const { row, col } of steepestCells(level, STEEP_CELLS)) {
      // On the shared diagonal (u + v = 1), and inside the upper triangle.
      points.push({ x: colToX(level.grid, col + 0.37), z: rowToZ(level.grid, row + 0.63), kind: 'steep-diagonal' });
      points.push({ x: colToX(level.grid, col + 0.8), z: rowToZ(level.grid, row + 0.6), kind: 'steep-upper' });
    }
    expect(points).toHaveLength(200);

    let maxErr = 0;
    let misses = 0;
    for (const p of points) {
      const hit = world.castRay(new R.Ray({ x: p.x, y: top, z: p.z }, { x: 0, y: -1, z: 0 }), 1000, true);
      if (!hit) {
        misses++;
        continue;
      }
      const err = Math.abs(top - hit.timeOfImpact - sampler.heightAt(p.x, p.z));
      maxErr = Math.max(maxErr, err);
    }
    console.log(`parity: ${points.length} points, ${misses} misses, max |collider - sampler| = ${(maxErr * 1000).toFixed(4)} mm`);
    expect(misses).toBe(0);
    expect(maxErr).toBeLessThanOrEqual(TOLERANCE_M);
  });
});
