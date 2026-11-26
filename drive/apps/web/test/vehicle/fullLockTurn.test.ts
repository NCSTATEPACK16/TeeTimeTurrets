/** Beyond the gate: full steering lock at top speed on flat ground must not roll either cart. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { loadTestLevel } from '../helpers/packet';

let sim: Simulation;
let joy: Simulation;
beforeAll(async () => {
  const level = await loadTestLevel();
  sim = await Simulation.create(level);
  joy = await Simulation.create(level, 'joyride');
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

  // Joyride at 20 m/s asks for Turrets' 2.4 rad/s, which the tyres cannot give (cartTuning.ts):
  // it must slide, not roll. Assists on, as a player drives it; the assist needs 2 s past 70°.
  for (const steer of [1, -1]) {
    it(`Joyride at 20 m/s stays on its wheels at full lock (steer ${steer > 0 ? 'right' : 'left'})`, () => {
      // Launched at speed, so a cart too unstable to reach 20 m/s still meets the tilt check.
      joy.launch(joy.level.course.qa.driveStart, 20);
      joy.run({ ...NO_INPUT, throttle: 1 }, 30);
      const entry = joy.cart.forwardSpeed();
      let maxTilt = 0;
      let peakYaw = 0;
      joy.run({ ...NO_INPUT, throttle: 1, steer }, 3 * 60, (s) => {
        maxTilt = Math.max(maxTilt, s.cart.tiltDeg());
        peakYaw = Math.max(peakYaw, Math.abs(s.cart.yawRateDeg()));
      });
      console.log(
        `Joyride full lock ${steer > 0 ? 'right' : 'left'}: entry ${entry.toFixed(2)} m/s, max tilt ${maxTilt.toFixed(2)}°, ` +
          `peak yaw ${peakYaw.toFixed(1)}°/s, exit ${joy.cart.forwardSpeed().toFixed(2)} m/s`,
      );
      expect(maxTilt).toBeLessThan(35);
      expect(entry).toBeGreaterThan(19);
      expect(joy.cart.rightingAssistEngaged()).toBe(false);
    });
  }
});
