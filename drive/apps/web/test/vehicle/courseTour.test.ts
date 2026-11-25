/**
 * M2 gate: "the cart drives the whole course". Chill drives every cart path in paths.json end to
 * end with a pure-pursuit driver: no NaN, no fall-through, never stuck, never more than OFF_PATH_M
 * from the centerline, and it reaches the far end. On a real course it also drives the whole round
 * as one route on the connected network (M2 close-out).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PathsJson } from '@gcs/level-schema';
import { Simulation } from '../../src/core/sim';
import { FIXED_DT } from '../../src/physics/physicsConfig';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { IS_SYNTHETIC, LEVEL_ID, loadTestLevel } from '../helpers/packet';
import { PathNetwork, REACH_M, reversals } from '../helpers/network';

const LOOKAHEAD_M = 5;
const CRUISE = 0.7; // throttle
const STEER_GAIN = 2.0; // steer per radian of heading error
const OFF_PATH_M = 2.5;
/** Junction pad radius (course.toml paths.junction_pad_m): a square turn may cut its corner this far. */
const JUNCTION_PAD_M = 4;
/** How far past a junction the cart may still be settling out of a square turn. */
const JUNCTION_M = 12;
const END_REACH_M = 4;
const STUCK_S = 6;

type PathEntry = PathsJson['paths'][number];

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'chill');
});

/** Cumulative arc length per centerline point. */
function arcLengths(pts: PathEntry['points']): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]));
  }
  return s;
}

/** Nearest point index at or after `from` within a search window, and its distance (for progress). */
function track(pts: PathEntry['points'], x: number, z: number, from: number): [number, number] {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < Math.min(pts.length, from + 80); i++) {
    const d = Math.hypot(pts[i]![0] - x, pts[i]![2] - z);
    if (d < bestD) [best, bestD] = [i, d];
  }
  return [best, bestD];
}

function headingDeg(): number {
  const q = sim.cart.body.rotation();
  const yaw = 2 * Math.atan2(q.y, q.w);
  return ((-yaw * 180) / Math.PI + 360) % 360;
}

describe(`course tour (${LEVEL_ID})`, () => {
  it('has cart paths to drive', () => {
    expect(sim.level.paths.paths.length).toBeGreaterThan(0);
  });


  it('drives every cart path end to end', () => {
    const lines: string[] = [];
    for (const path of sim.level.paths.paths) {
      const pts = path.points;
      const s = arcLengths(pts);
      const length = s[s.length - 1]!;
      const ahead = pts[Math.min(pts.length - 1, 3)]!;
      const h0 = (Math.atan2(ahead[0] - pts[0]![0], -(ahead[2] - pts[0]![2])) * 180) / Math.PI;
      sim.reset({ x: pts[0]![0], z: pts[0]![2], headingDeg: (h0 + 360) % 360 });
      let idx = 0;
      let maxOff = 0;
      let worstAt = '';
      let still = 0;
      let reached = false;
      const maxSteps = Math.round((length / 1.5 + 20) / FIXED_DT);
      let steps = 0;
      for (; steps < maxSteps && !reached; steps++) {
        const p = sim.cart.position();
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), path.id).toBe(true);
        const [i] = track(pts, p.x, p.z, idx);
        idx = i;
        // Distance to the network's centerlines (the game's PathSampler): where paths cross, the
        // pipeline leaves the junction to the earlier path, so this path's own points have a gap.
        const off = sim.paths.nearest(p.x, p.z)?.distance ?? Infinity;
        if (off > maxOff) {
          maxOff = off;
          worstAt = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) after ${s[idx]!.toFixed(0)} m`;
        }
        if (s[s.length - 1]! - s[idx]! < END_REACH_M) reached = true;
        let j = idx;
        while (j < pts.length - 1 && s[j]! - s[idx]! < LOOKAHEAD_M) j++;
        const want = Math.atan2(pts[j]![0] - p.x, -(pts[j]![2] - p.z));
        let err = want - (headingDeg() * Math.PI) / 180;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        sim.step({ ...NO_INPUT, throttle: CRUISE, steer: Math.max(-1, Math.min(1, STEER_GAIN * err)) });
        still = Math.abs(sim.cart.forwardSpeed()) < 0.2 ? still + 1 : 0;
        expect(still * FIXED_DT, `${path.id} stuck near (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeLessThan(STUCK_S);
        const ground = sim.heights.heightAt(p.x, p.z);
        expect(p.y, `${path.id} under the ground at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThan(ground - 1);
      }
      lines.push(`${path.id} ${length.toFixed(0)} m in ${(steps * FIXED_DT).toFixed(0)} s, max off ${maxOff.toFixed(2)} m at ${worstAt}`);
      const q = sim.cart.position();
      expect(
        reached,
        `${path.id} did not reach its end: at (${q.x.toFixed(1)}, ${q.z.toFixed(1)}), ${s[idx]!.toFixed(0)} of ${length.toFixed(0)} m`,
      ).toBe(true);
      expect(maxOff, `${path.id} left the path at ${worstAt}`).toBeLessThan(OFF_PATH_M);
    }
    console.log(`course tour: ${lines.join('; ')}`);
  }, 600_000); // ~6 km of path on the full course

  // M2 close-out: one drive on the connected network, tee 1 to green 18 by way of every green.
  // Where the network dead-ends (a hole path runs on past its green and the connector leaves back
  // the way it came) the cart stops and is turned round in place; those are counted and reported.
  it.runIf(!IS_SYNTHETIC)(
    'drives the round, tee 1 to green 18, on the cart-path network',
    () => {
      const net = new PathNetwork(sim.level.paths.paths);
      const holes = sim.level.holes.holes;
      const route = net.round(holes);
      expect(route.length, 'no way along the network from tee 1 to green 18').toBeGreaterThan(0);
      const pts = route.map((i) => net.points[i]!);
      for (const h of holes) {
        const g = Math.min(...pts.map((q) => Math.hypot(q.x - h.green.x, q.z - h.green.z)));
        expect(g, `the round misses green ${h.number}`).toBeLessThanOrEqual(
          Math.max(REACH_M, net.nearest(h.green.x, h.green.z)[1] + 5),
        );
      }
      const turns = reversals(net, route);
      // Legs between turnarounds, each driven forwards.
      const cuts = [0, ...turns, pts.length - 1];
      let total = 0;
      let maxOff = 0;
      let worstAt = '';
      // Junctions on the route (where it changes path): inside the level pad there the cart may
      // cut the corner of a square turn, up to the pad's radius.
      const junctions = pts.filter((q, i) => i > 0 && q.path !== pts[i - 1]!.path);
      let maxOffJ = 0;
      let worstJ = '';
      let seconds = 0;
      for (let k = 0; k + 1 < cuts.length; k++) {
        const leg = pts.slice(cuts[k]!, cuts[k + 1]! + 1);
        if (leg.length < 6) continue;
        const s = [0];
        for (let i = 1; i < leg.length; i++)
          s.push(s[i - 1]! + Math.hypot(leg[i]!.x - leg[i - 1]!.x, leg[i]!.z - leg[i - 1]!.z));
        const length = s[s.length - 1]!;
        total += length;
        const ahead = leg[Math.min(leg.length - 1, 4)]!;
        const heading = (Math.atan2(ahead.x - leg[0]!.x, -(ahead.z - leg[0]!.z)) * 180) / Math.PI;
        if (k === 0) {
          sim.reset({
            x: leg[0]!.x,
            z: leg[0]!.z,
            headingDeg: (heading + 360) % 360,
          });
        } else {
          // Turn round where the network dead-ends: come to rest (the leg before has reached
          // within END_REACH_M of this point), then face the new leg from the turning point.
          for (let i = 0; i < 600 && Math.abs(sim.cart.forwardSpeed()) > 0.1; i++) sim.step({ ...NO_INPUT, brake: 1 });
          sim.reset({ x: leg[0]!.x, z: leg[0]!.z, headingDeg: (heading + 360) % 360 });
        }
        let idx = 0;
        let still = 0;
        let reached = false;
        const maxSteps = Math.round((length / 1.5 + 20) / FIXED_DT);
        for (let steps = 0; steps < maxSteps && !reached; steps++) {
          const p = sim.cart.position();
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `leg ${k}`).toBe(true);
          let best = idx;
          let bestD = Infinity;
          for (let i = idx; i < Math.min(leg.length, idx + 80); i++) {
            const d = Math.hypot(leg[i]!.x - p.x, leg[i]!.z - p.z);
            if (d < bestD) [best, bestD] = [i, d];
          }
          idx = best;
          const off = sim.paths.nearest(p.x, p.z)?.distance ?? Infinity;
          const atJunction = junctions.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < JUNCTION_M);
          const where = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) on ${leg[idx]!.path}`;
          if (atJunction && off > maxOffJ) [maxOffJ, worstJ] = [off, where];
          if (!atJunction && off > maxOff) [maxOff, worstAt] = [off, where];
          if (length - s[idx]! < END_REACH_M) reached = true;
          let j = idx;
          while (j < leg.length - 1 && s[j]! - s[idx]! < LOOKAHEAD_M) j++;
          const want = Math.atan2(leg[j]!.x - p.x, -(leg[j]!.z - p.z));
          let err = want - (headingDeg() * Math.PI) / 180;
          err = Math.atan2(Math.sin(err), Math.cos(err));
          // Ease off for bends, as a driver would on a narrow path.
          // ...and roll up slowly to a turnaround, since the path may end just past it.
          const bend = Math.min(1, Math.abs(err) / 0.5);
          const turning = k + 2 < cuts.length && length - s[idx]! < 12;
          const v = sim.cart.forwardSpeed();
          sim.step({
            ...NO_INPUT,
            throttle: turning ? (v < 1.5 ? 0.25 : 0) : CRUISE * (1 - 0.85 * bend),
            brake: (v > 3 && bend > 0.6) || (turning && v > 2) ? 0.5 : 0,
            steer: Math.max(-1, Math.min(1, STEER_GAIN * err)),
          });
          seconds += FIXED_DT;
          still = Math.abs(sim.cart.forwardSpeed()) < 0.2 ? still + 1 : 0;
          expect(
            still * FIXED_DT,
            `stuck near (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) on ${leg[idx]!.path}`,
          ).toBeLessThan(STUCK_S);
          expect(p.y, `under the ground at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThan(
            sim.heights.heightAt(p.x, p.z) - 1,
          );
        }
        const q = sim.cart.position();
        expect(reached, `leg ${k} stopped at (${q.x.toFixed(1)}, ${q.z.toFixed(1)}) on ${leg[idx]!.path}`).toBe(true);
      }
      expect(maxOff, `left the network at ${worstAt}`).toBeLessThan(OFF_PATH_M);
      expect(maxOffJ, `cut a junction too wide at ${worstJ}`).toBeLessThan(JUNCTION_PAD_M);
      const where = turns.map((i) => pts[i]!.path).join(', ');
      console.log(
        `round: tee 1 to green 18, ${total.toFixed(0)} m in ${seconds.toFixed(0)} s, ${turns.length} turnarounds (${where}), max off ${maxOff.toFixed(2)} m at ${worstAt}, at junctions ${maxOffJ.toFixed(2)} m at ${worstJ}`,
      );
    },
    900_000,
  );
});
