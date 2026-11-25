/** Sign conventions and basic pedal behavior: a cart that drives sideways or backwards fails here. */
import { beforeAll, describe, expect, it } from 'vitest';
import { headingToForward } from '@gcs/level-schema';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import type { Pose } from '@gcs/level-schema';
import { IS_SYNTHETIC, loadTestLevel, realCourse } from '../helpers/packet';

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
});

const settle = () => sim.run(NO_INPUT, 60);

/** A node of rough or fairway on a 6 to 10% grade with no tree within 6 m, heading downhill. */
function slopePose(): Pose {
  const { grid, scatter } = sim.level;
  const hx = (grid.width - 1) / 2;
  const hz = (grid.height - 1) / 2;
  for (let z = -hz + 20; z < hz - 20; z += 7) {
    for (let x = -hx + 20; x < hx - 20; x += 7) {
      const m = sim.surfaces.materialAt(x, z);
      if (m !== 'rough' && m !== 'fairway') continue;
      const n = sim.heights.normalAt(x, z);
      const grade = Math.sqrt(1 - n.y * n.y) / n.y;
      if (grade < 0.06 || grade > 0.1) continue;
      let clear = true;
      for (let i = 0; i < scatter.length && clear; i += 4) {
        if (Math.hypot(scatter[i]! - x, scatter[i + 1]! - z) < 6) clear = false;
      }
      // Similar grade 3 m around, so the whole cart sits on the same slope.
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
        const nn = sim.heights.normalAt(x + dx, z + dz);
        const g = Math.sqrt(1 - nn.y * nn.y) / nn.y;
        if (Math.abs(g - grade) > 0.03) clear = false;
      }
      if (!clear) continue;
      // Downhill is along the horizontal normal: heading = atan2(nx, -nz).
      const headingDeg = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
      return { x, z, headingDeg };
    }
  }
  throw new Error('no 6 to 10% slope found');
}

describe('cart conventions', () => {
  it('drives along its heading under throttle', () => {
    const start = sim.level.course.qa.driveStart;
    sim.reset(start);
    settle();
    const p0 = { ...sim.cart.position() };
    sim.run({ ...NO_INPUT, throttle: 1 }, 180);
    const p1 = sim.cart.position();
    const f = headingToForward(start.headingDeg);
    const along = (p1.x - p0.x) * f.x + (p1.z - p0.z) * f.z;
    const lateral = Math.abs((p1.x - p0.x) * -f.z + (p1.z - p0.z) * f.x);
    expect(along).toBeGreaterThan(IS_SYNTHETIC ? 8 : realCourse.minAlongM);
    expect(lateral).toBeLessThan(0.3);
    expect(sim.cart.forwardSpeed()).toBeGreaterThan(4);
  });

  it('brakes to a stop, then reverses while the brake is held', () => {
    sim.reset(sim.level.course.qa.driveStart);
    settle();
    sim.run({ ...NO_INPUT, throttle: 1 }, 240);
    let stopStep = -1;
    for (let i = 0; i < 300 && stopStep < 0; i++) {
      sim.step({ ...NO_INPUT, brake: 1 });
      if (sim.cart.forwardSpeed() < 0.3) stopStep = i;
    }
    expect(stopStep).toBeGreaterThan(0);
    expect(stopStep).toBeLessThan(120); // from ~6.5 m/s at ~0.6 g: about 1.1 s
    sim.run({ ...NO_INPUT, brake: 1 }, 240);
    expect(sim.cart.forwardSpeed()).toBeLessThan(-1.5);
    expect(sim.cart.forwardSpeed()).toBeGreaterThan(-sim.cart.tuning.drive.reverseTopSpeed - 0.3);
  });

  it('turns right for steer +1 and left for steer -1', () => {
    for (const steer of [1, -1]) {
      const start = sim.level.course.qa.driveStart;
      sim.reset(start);
      settle();
      sim.run({ ...NO_INPUT, throttle: 0.5 }, 90);
      sim.run({ ...NO_INPUT, throttle: 0.5, steer }, 60);
      // Compass heading of the forward vector, relative to the start: right turns increase it.
      const f = sim.cart.forward();
      const heading = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
      const turned = ((heading - start.headingDeg + 540) % 360) - 180;
      if (steer > 0) expect(turned).toBeGreaterThan(5);
      else expect(turned).toBeLessThan(-5);
    }
  });

  it('holds still with no input on a slope', () => {
    // dummy-01: a point on its north ridge, facing downhill-ish. A real course: the first open
    // grass node on a 6 to 10% grade, facing straight downhill. The auto hold must keep it parked.
    sim.reset(IS_SYNTHETIC ? { x: 0, z: -175, headingDeg: 180 } : slopePose());
    sim.run(NO_INPUT, 120);
    const p0 = { ...sim.cart.position() };
    sim.run(NO_INPUT, 180);
    const p1 = sim.cart.position();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeLessThan(0.05);
  });
});
