import { describe, expect, it } from 'vitest';
import type { GridInfo, HorizonInfo } from '@gcs/level-schema';
import { buildHorizonArrays } from '../../src/terrain/horizon';

const info: HorizonInfo = {
  file: 'horizon.u16.bin',
  cellSize: 10,
  width: 21,
  height: 21,
  originX: -100,
  originZ: -100,
  scale: 0.002,
  offset: 0,
};

describe('horizon skirt geometry', () => {
  const heights = new Float32Array(21 * 21).map((_, i) => 100 + (i % 21));
  const course: GridInfo = { width: 61, height: 41, cellSize: 1 };
  const a = buildHorizonArrays(info, heights, course, [0.1, 0.2, 0.1]);

  it('places nodes on the world grid with packet heights, row 0 north', () => {
    expect([a.positions[0], a.positions[1], a.positions[2]]).toEqual([-100, 100, -100]);
    const k = (20 * 21 + 20) * 3;
    expect([a.positions[k], a.positions[k + 1], a.positions[k + 2]]).toEqual([100, 120, 100]);
  });

  it('drops cells well inside the course and keeps a one-cell overlap ring', () => {
    // Course is ±30 x ±20 m; shrunk by a 10 m cell that is ±20 x ±10 m: 4 x 2 cells dropped.
    expect(a.cells).toBe(20 * 20 - 4 * 2);
    expect(a.indices.length).toBe(a.cells * 6);
  });

  it('draws every second node at stride 2', () => {
    const b = buildHorizonArrays(info, heights, course, [0.1, 0.2, 0.1], 2);
    // 10 x 10 cells of 20 m; the course shrunk by 20 m is ±10 x ±0 m, so nothing is fully inside.
    expect(b.cells).toBe(10 * 10);
    expect(Math.max(...b.indices)).toBe(21 * 21 - 1);
  });

  it('winds counter-clockwise seen from above (normals up)', () => {
    const [i0, i1, i2] = [a.indices[0]!, a.indices[1]!, a.indices[2]!];
    const p = (i: number) => [a.positions[i * 3]!, a.positions[i * 3 + 2]!];
    const [ax, az] = p(i0);
    const [bx, bz] = p(i1);
    const [cx, cz] = p(i2);
    // y of (b - a) x (c - a) is positive for an up-facing triangle in three's +Y-up, -Z-north frame.
    expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
  });
});
