/**
 * Render budget (PRD High: 2 M triangles, 300 draw calls). The camera is put at every point of a
 * 40 m grid over the course, 3 m up, and the scene is counted before frustum culling (the worst
 * case: everything in view): terrain chunks at their LOD, the whole horizon skirt and every tree
 * instance. That must stay under SCENE_SHARE of the budget, leaving the rest for water, the cart,
 * skid marks and particles.
 */
import { describe, expect, it } from 'vitest';
import { envConfig } from '../../src/env/envConfig';
import { HeightSampler } from '../../src/level/heightSampler';
import { treeLoad } from '../../src/env/trees';
import { buildHorizonArrays } from '../../src/terrain/horizon';
import { buildTerrainChunk } from '../../src/terrain/terrainGeometry';
import { chunkTriangles, lodIndex, terrainLoad } from '../../src/terrain/chunks';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const SCENE_SHARE = 0.9;

describe(`terrain budget (${LEVEL_ID})`, () => {
  it('chunkTriangles matches the built geometry at every stride', () => {
    const grid = { width: 40, height: 30, cellSize: 1 };
    const n = grid.width * grid.height;
    for (const stride of [1, 2, 4]) {
      const a = buildTerrainChunk(grid, new Float64Array(n), new Uint8Array(n), [[0, 0, 0]], 3, 2, 33, 27, stride, 3);
      expect(a.indices.length / 3).toBe(chunkTriangles(33, 27, stride, true));
    }
  });

  it('picks LOD levels by distance', () => {
    const levels = envConfig.terrain.lod;
    expect(lodIndex(levels, 0)).toBe(0);
    expect(lodIndex(levels, levels[1]!.distance + 1)).toBe(1);
    expect(lodIndex(levels, 1e6)).toBe(levels.length - 1);
  });

  it('stays inside the High budget anywhere on the course', async () => {
    const level = await loadTestLevel();
    const heights = new HeightSampler(level.grid, level.heights);
    const hz = level.horizon
      ? buildHorizonArrays(level.horizon.info, level.horizon.heights, level.grid, [0, 0, 0], envConfig.horizon.stride).cells * 2
      : 0;
    const trees = treeLoad(level);
    const hx = (level.grid.width - 1) / 2;
    const hzz = (level.grid.height - 1) / 2;
    let worst = { triangles: 0, drawCalls: 0, terrain: 0, at: [0, 0] };
    for (let x = -hx; x <= hx; x += 40) {
      for (let z = -hzz; z <= hzz; z += 40) {
        const t = terrainLoad(level, [x, heights.heightAt(x, z) + 3, z]);
        const total = t.triangles + hz + trees.triangles;
        if (total > worst.triangles) {
          worst = { triangles: total, drawCalls: t.drawCalls + (hz ? 1 : 0) + trees.drawCalls, terrain: t.triangles, at: [x, z] };
        }
      }
    }
    const { triangles, drawCalls } = envConfig.renderBudget;
    console.log(
      `render budget: worst ${(worst.triangles / 1e6).toFixed(2)} M triangles (terrain ${(worst.terrain / 1e6).toFixed(2)} M, ` +
        `horizon ${(hz / 1e6).toFixed(2)} M, trees ${(trees.triangles / 1e6).toFixed(2)} M), ${worst.drawCalls} draws at (${worst.at.join(', ')})`,
    );
    expect(worst.triangles).toBeLessThanOrEqual(triangles * SCENE_SHARE);
    expect(worst.drawCalls).toBeLessThanOrEqual(drawCalls * SCENE_SHARE);
  });
});
