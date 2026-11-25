/**
 * M2 gate: "the cart drives ... the horizon edge". Joyride runs flat out at each of the four
 * course edges. The invisible boundary walls (physics/boundaryColliders.ts) must stop it at the
 * edge: it gets there, never leaves the grid, and its height stays sane (no fall-through).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Pose } from '@gcs/level-schema';
import { Simulation } from '../../src/core/sim';
import { physicsConfig } from '../../src/physics/physicsConfig';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const RUN_IN_M = 20;
const LANE_CLEAR_M = 3;
const MAX_STEEP = 0.25;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'joyride');
});

/** A start RUN_IN_M inside the edge, heading straight out, with no trunk near the lane and no steep ground. */
function laneTo(edge: 'north' | 'south' | 'east' | 'west'): Pose | null {
  const { grid, scatter } = sim.level;
  const hx = (grid.width - 1) / 2;
  const hz = (grid.height - 1) / 2;
  const span = edge === 'north' || edge === 'south' ? hx : hz;
  for (let k = 0; k <= span - 30; k += 5) {
    for (const s of k === 0 ? [0] : [k, -k]) {
      let x0: number, z0: number, x1: number, z1: number, headingDeg: number;
      if (edge === 'north') [x0, z0, x1, z1, headingDeg] = [s, -hz + RUN_IN_M, s, -hz, 0];
      else if (edge === 'south') [x0, z0, x1, z1, headingDeg] = [s, hz - RUN_IN_M, s, hz, 180];
      else if (edge === 'east') [x0, z0, x1, z1, headingDeg] = [hx - RUN_IN_M, s, hx, s, 90];
      else [x0, z0, x1, z1, headingDeg] = [-hx + RUN_IN_M, s, -hx, s, 270];
      let ok = true;
      for (let i = 0; i < scatter.length && ok; i += 4) {
        const tx = scatter[i]!;
        const tz = scatter[i + 1]!;
        const along = (x1 - x0) * (tx - x0) + (z1 - z0) * (tz - z0);
        const len2 = RUN_IN_M * RUN_IN_M;
        const t = Math.min(Math.max(along / len2, -0.2), 1.2);
        if (Math.hypot(x0 + (x1 - x0) * t - tx, z0 + (z1 - z0) * t - tz) < LANE_CLEAR_M) ok = false;
      }
      for (let d = 0; d < RUN_IN_M && ok; d += 2) {
        const t = d / RUN_IN_M;
        const n = sim.heights.normalAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        if (Math.sqrt(1 - n.y * n.y) / n.y > MAX_STEEP) ok = false;
      }
      if (ok) return { x: x0, z: z0, headingDeg };
    }
  }
  return null;
}

describe(`course edge (${LEVEL_ID})`, () => {
  for (const edge of ['north', 'south', 'east', 'west'] as const) {
    it(`stops the cart at the ${edge} edge`, () => {
      const pose = laneTo(edge);
      expect(pose, `no clear lane to the ${edge} edge`).not.toBeNull();
      sim.launch(pose!, 6);
      const { grid } = sim.level;
      const hx = (grid.width - 1) / 2;
      const hz = (grid.height - 1) / 2;
      const limit = physicsConfig.boundary.thickness;
      let closest = Infinity;
      let worstDrop = 0;
      sim.run({ ...NO_INPUT, throttle: 1 }, 8 * 60, (s) => {
        const p = s.cart.position();
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThan(hx + limit);
        expect(Math.abs(p.z)).toBeLessThan(hz + limit);
        const ground = s.heights.heightAt(Math.max(-hx, Math.min(hx, p.x)), Math.max(-hz, Math.min(hz, p.z)));
        worstDrop = Math.max(worstDrop, ground - p.y);
        const gap = edge === 'north' ? p.z + hz : edge === 'south' ? hz - p.z : edge === 'east' ? hx - p.x : p.x + hx;
        closest = Math.min(closest, gap);
      });
      console.log(`${edge} edge: lane at (${pose!.x}, ${pose!.z}), closest ${closest.toFixed(2)} m, worst drop ${worstDrop.toFixed(2)} m`);
      expect(closest).toBeLessThan(3);
      expect(worstDrop).toBeLessThan(1);
    });
  }
});
