import { beforeAll, describe, expect, it } from 'vitest';
import { headingToForward } from '@gcs/level-schema';
import { HeightSampler } from '../../src/level/heightSampler';
import type { Level } from '../../src/level/loadLevel';
import { WaterSampler, pointInPolygon } from '../../src/level/waterSampler';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

describe('pointInPolygon', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('is true inside and false outside', () => {
    expect(pointInPolygon(square, 5, 5)).toBe(true);
    expect(pointInPolygon(square, 0.01, 9.99)).toBe(true);
    expect(pointInPolygon(square, -0.01, 5)).toBe(false);
    expect(pointInPolygon(square, 5, 10.01)).toBe(false);
  });
});

describe(`WaterSampler (${LEVEL_ID})`, () => {
  let level: Level;
  let water: WaterSampler;
  beforeAll(async () => {
    level = await loadTestLevel();
    water = new WaterSampler(level.course.water, new HeightSampler(level.grid, level.heights));
  });

  it('finds water at every water probe and none at dry probes', () => {
    for (const p of level.course.qa.probes) {
      const depth = water.depthAt(p.x, p.z);
      if (p.material === 'water') expect(depth, `${p.x}, ${p.z}`).toBeGreaterThan(0);
      if (p.material === 'cartpath' || p.material === 'tee') expect(depth).toBe(0);
    }
  });

  it('reads about 0.5 m a few meters past qa.waterEntry', () => {
    const e = level.course.qa.waterEntry;
    if (!e) return;
    expect(water.depthAt(e.x, e.z)).toBe(0);
    const f = headingToForward(e.headingDeg);
    const hit = water.at(e.x + f.x * 20, e.z + f.z * 20);
    expect(hit).not.toBeNull();
    expect(hit!.depth).toBeGreaterThan(0.45);
    expect(hit!.depth).toBeLessThan(0.55);
  });
});
