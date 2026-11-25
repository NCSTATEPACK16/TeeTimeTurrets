import { describe, expect, it } from 'vitest';
import { colToX, rowToZ } from '@gcs/level-schema';
import { HeightSampler } from '../../src/level/heightSampler';
import { buildTerrainChunk, chunkLayout, hexToLinear } from '../../src/terrain/terrainGeometry';
import { loadTestLevel, mulberry32 } from '../helpers/packet';

/** Height of the render mesh at (x, z): find the mesh triangle containing the point and interpolate. */
function meshHeightAt(pos: Float32Array, idx: Uint32Array, x: number, z: number): number | null {
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const ax = pos[a * 3]!, ay = pos[a * 3 + 1]!, az = pos[a * 3 + 2]!;
    const bx = pos[b * 3]!, by = pos[b * 3 + 1]!, bz = pos[b * 3 + 2]!;
    const cx = pos[c * 3]!, cy = pos[c * 3 + 1]!, cz = pos[c * 3 + 2]!;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * ay + l2 * by + l3 * cy;
  }
  return null;
}

describe('terrain render mesh', () => {
  it('matches the collider/sampler surface at random points (same triangulation)', async () => {
    const level = await loadTestLevel();
    const sampler = new HeightSampler(level.grid, level.heights);
    const palette = level.course.materials.map((m) => hexToLinear(m.color));
    const [c0, r0, cols, rows] = [200, 300, 24, 16];
    const chunk = buildTerrainChunk(level.grid, level.heights, level.material, palette, c0, r0, cols, rows);
    const rand = mulberry32(7);
    let maxErr = 0;
    for (let i = 0; i < 300; i++) {
      const x = colToX(level.grid, c0 + 0.001 + rand() * (cols - 0.002));
      const z = rowToZ(level.grid, r0 + 0.001 + rand() * (rows - 0.002));
      const h = meshHeightAt(chunk.positions, chunk.indices, x, z);
      expect(h).not.toBeNull();
      maxErr = Math.max(maxErr, Math.abs(h! - sampler.heightAt(x, z)));
    }
    expect(maxErr).toBeLessThan(1e-4); // Float32 vertex positions
  });

  it('winds every triangle counter-clockwise seen from above (normals up)', () => {
    const grid = { width: 4, height: 3, cellSize: 1 };
    const chunk = buildTerrainChunk(grid, new Float64Array(12), new Uint8Array(12), [[0, 0, 0]], 0, 0, 3, 2);
    const p = chunk.positions;
    for (let t = 0; t < chunk.indices.length; t += 3) {
      const [a, b, c] = [chunk.indices[t]!, chunk.indices[t + 1]!, chunk.indices[t + 2]!];
      const e1 = [p[b * 3]! - p[a * 3]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
      const e2 = [p[c * 3]! - p[a * 3]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
      // y component of (b - a) x (c - a) = dz1 * dx2 - dx1 * dz2
      expect(e1[1]! * e2[0]! - e1[0]! * e2[1]!).toBeGreaterThan(0);
    }
  });

  it('tiles the whole grid with chunks', () => {
    const grid = { width: 513, height: 513, cellSize: 1 };
    const chunks = chunkLayout(grid, 128);
    expect(chunks).toHaveLength(16);
    const cells = chunks.reduce((n, [, , c, r]) => n + c * r, 0);
    expect(cells).toBe(512 * 512);
    expect(chunkLayout({ width: 300, height: 200, cellSize: 1 }, 128).map(([, , c, r]) => [c, r])).toEqual([
      [128, 128], [128, 128], [43, 128], [128, 71], [128, 71], [43, 71],
    ]);
  });

  it('converts palette colors from sRGB to linear', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
  });
});
