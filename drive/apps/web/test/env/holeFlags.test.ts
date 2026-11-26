/**
 * Hole flags and tee signs, in Node with no renderer. The holes come from the shipped Tee Time Links
 * packet, not the default dummy-01 test level: the flags exist for its 18 pins.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three/webgpu';
import { envConfig } from '../../src/env/envConfig';
import { FlagKnocks, flagMatrix, placeHoleFlags, type FlagPlacement } from '../../src/env/holeFlags';
import { placeTeeSigns } from '../../src/env/teeSigns';
import { HeightSampler } from '../../src/level/heightSampler';
import type { Level } from '../../src/level/loadLevel';
import { PathSampler } from '../../src/level/pathSampler';
import { loadTestLevel } from '../helpers/packet';

const POLE = envConfig.flags.pole.height;
const DT = 1 / 60;

let level: Level;
let heights: HeightSampler;
let flags: FlagPlacement[];
const heightAt = (x: number, z: number) => heights.heightAt(x, z);

beforeAll(async () => {
  level = await loadTestLevel('tee-time-links');
  heights = new HeightSampler(level.grid, level.heights);
  flags = placeHoleFlags(level.holes.holes, heightAt);
});

/** Where the GPU draws a point of the pole: the instance matrix applied to it. */
function polePoint(knocks: FlagKnocks, i: number, y: number): Vector3 {
  return new Vector3(0, y, 0).applyMatrix4(flagMatrix(flags[i]!, knocks.pose(i), new Matrix4()));
}

describe('hole flags on Tee Time Links', () => {
  it('stands one flag on each of the 18 pins, on the ground', () => {
    const holes = level.holes.holes;
    expect(level.course.id).toBe('tee-time-links');
    expect(holes.map((h) => h.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const h of holes) expect(h.pin).toEqual(h.green);
    // The ground under the pins is not flat, so a flag at a constant height can't pass.
    const pinHeights = holes.map((h) => heightAt(h.pin.x, h.pin.z));
    expect(Math.max(...pinHeights) - Math.min(...pinHeights)).toBeGreaterThan(1);

    expect(flags).toHaveLength(18);
    const knocks = new FlagKnocks(flags, heightAt);
    flags.forEach((f, i) => {
      const pin = holes.find((h) => h.number === f.hole)!.pin;
      expect(f.hole).toBe(i + 1);
      const ground = heightAt(pin.x, pin.z);
      const foot = polePoint(knocks, i, 0);
      const top = polePoint(knocks, i, POLE);
      expect([foot.x, foot.y, foot.z].map((v) => +v.toFixed(4))).toEqual([pin.x, ground, pin.z].map((v) => +v.toFixed(4)));
      expect([top.x, top.y, top.z].map((v) => +v.toFixed(4))).toEqual([pin.x, ground + POLE, pin.z].map((v) => +v.toFixed(4)));
    });

    // Clear of the spawn and every qa pose in course.json.
    const qa = level.course.qa;
    const poses = [level.course.spawn, qa.driveStart, qa.waterEntry, qa.deepWater, qa.wheelPad].filter((p) => p !== undefined);
    expect(poses.length).toBeGreaterThanOrEqual(4);
    for (const f of flags) {
      for (const p of poses) expect(Math.hypot(f.x - p.x, f.z - p.z)).toBeGreaterThan(envConfig.flags.clearM);
    }
  });

  it("draws hole 7's cloth and tee sign from hole 7", () => {
    expect(flags[6]!.hole).toBe(7);
    expect(flags[6]!.lines).toEqual(['7', 'PAR 4']);

    const signs = placeTeeSigns(level.holes.holes, level.paths.paths);
    expect(signs[6]!.hole).toBe(7);
    // Hole 7's path (365 yd) is shorter than its tee-to-pin line, so the straight distance prints.
    expect(signs[6]!.lines).toEqual(['HOLE 7', 'PAR 4', '387 YDS']);
    // Hole 2's path (437 yd) is longer than its straight line (400), so the path prints.
    expect(signs[1]!.lines[2]).toBe('437 YDS');
    // Hole 1 has no h01-path (only -east and -west): the straight distance.
    expect(signs[0]!.lines[2]).toBe('503 YDS');
  });

  it('puts each tee sign beside its tee, off the cart paths and off the spawn', () => {
    const sampler = new PathSampler(level.paths.paths);
    const signs = placeTeeSigns(level.holes.holes, level.paths.paths, sampler);
    const beside = Math.hypot(envConfig.teeSigns.sideM, envConfig.teeSigns.backM);
    expect(signs).toHaveLength(18);
    for (const s of signs) {
      const tee = level.holes.holes.find((h) => h.number === s.hole)!.tee;
      expect(Math.hypot(s.x - tee.x, s.z - tee.z)).toBeCloseTo(beside, 6);
      // No cart path runs within 7.6 m of a tee on this course (hole 8's is the nearest), so both
      // sides pass here; the side rule decides only where a path runs past a tee.
      const path = sampler.nearest(s.x, s.z)!;
      const width = level.paths.paths.find((p) => p.id === path.pathId)!.width;
      expect(path.distance).toBeGreaterThan(width / 2 + 1);
    }
    const spawn = level.course.spawn;
    expect(Math.hypot(signs[0]!.x - spawn.x, signs[0]!.z - spawn.z)).toBeGreaterThan(3);
  });

  it('falls away from a cart passing through over 0.4 s, and stands back up about 4 s later', () => {
    const i = 6;
    const f = flags[i]!;
    const tee = level.holes.holes[i]!.tee;
    // A cart driving down the hole into the pin.
    const len = Math.hypot(f.x - tee.x, f.z - tee.z);
    const dx = (f.x - tee.x) / len;
    const dz = (f.z - tee.z) / len;
    const y = f.y + 0.6;
    const cartAt = (behind: number) => ({ x: f.x - dx * behind, y, z: f.z - dz * behind });
    const moving = (speed: number) => ({ x: dx * speed, y: 0, z: dz * speed });
    const far = { x: f.x + 500, y, z: f.z + 500 };
    const still = { x: 0, y: 0, z: 0 };
    const knocks = new FlagKnocks(flags, heightAt);
    const advance = (seconds: number) => {
      for (let n = Math.round(seconds / DT); n > 0; n--) knocks.step(DT, far, still);
    };

    knocks.step(DT, cartAt(1), moving(0.9));
    expect(knocks.pose(i).tilt).toBe(0); // too slow
    knocks.step(DT, cartAt(envConfig.flags.knock.reachM + 0.2), moving(3));
    expect(knocks.pose(i).tilt).toBe(0); // out of reach
    knocks.step(DT, cartAt(1), moving(3));
    expect(knocks.moving).toBe(1);

    const rest = knocks.restAngle(i);
    expect(rest).toBeGreaterThan((60 * Math.PI) / 180);
    expect(rest).toBeLessThan((100 * Math.PI) / 180);

    advance(0.2);
    const partway = knocks.pose(i).tilt;
    expect(partway).toBeGreaterThan(0.1 * rest);
    expect(partway).toBeLessThan(0.9 * rest);

    advance(0.25); // 0.45 s after the knock
    expect(knocks.pose(i).tilt).toBeCloseTo(rest, 9);
    // The top has gone away from the cart, along its line of travel, by the fallen pole's reach.
    const foot = polePoint(knocks, i, 0);
    const top = polePoint(knocks, i, POLE);
    expect((top.x - foot.x) * dx + (top.z - foot.z) * dz).toBeCloseTo(POLE * Math.sin(rest), 6);
    expect((top.x - foot.x) * -dz + (top.z - foot.z) * dx).toBeCloseTo(0, 6);

    advance(3.45); // 3.9 s
    expect(knocks.pose(i).tilt).toBeCloseTo(rest, 9);

    advance(0.75); // 4.65 s
    expect(knocks.moving).toBe(0);
    expect(knocks.pose(i).tilt).toBe(0);
    expect(polePoint(knocks, i, POLE).y).toBeCloseTo(f.y + POLE, 9);

    knocks.step(DT, cartAt(1), moving(3));
    expect(knocks.moving).toBe(1); // upright again, so it can be knocked again
  });
});
