/** Beyond the gate: full steering lock at top speed on flat ground must not roll the Chill cart. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { loadTestLevel } from '../helpers/packet';

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
});

describe('full-lock turn at top speed', () => {
  for (const steer of [1, -1]) {
    it(`keeps roll under 35° (steer ${steer > 0 ? 'right' : 'left'})`, () => {
      sim.reset(sim.level.course.qa.driveStart);
      sim.run(NO_INPUT, 30);
      sim.run({ ...NO_INPUT, throttle: 1 }, 6 * 60); // ~6.5 m/s
      const entry = sim.cart.forwardSpeed();
      let maxRoll = 0;
      let minWheelsDown = 4;
      sim.run({ ...NO_INPUT, throttle: 1, steer }, 6 * 60, (s) => {
        maxRoll = Math.max(maxRoll, Math.abs(s.cart.rollDeg()));
        minWheelsDown = Math.min(minWheelsDown, s.cart.wheels().filter((w) => w.inContact).length);
      });
      console.log(
        `full lock ${steer > 0 ? 'right' : 'left'}: entry ${entry.toFixed(2)} m/s, max |roll| ${maxRoll.toFixed(2)}°, ` +
          `min wheels down ${minWheelsDown}, final tilt ${sim.cart.tiltDeg().toFixed(2)}°`,
      );
      expect(entry).toBeGreaterThan(6);
      expect(maxRoll).toBeLessThan(35);
      expect(sim.cart.tiltDeg()).toBeLessThan(35);
    });
  }
});
