/**
 * M1 gate: "Headless: handbrake at 10 m/s produces a yaw rate over 60°/s".
 * Rule agreed with John: Joyride at a steady 10 m/s, then handbrake plus full steer; the
 * peak yaw rate within 1.5 s must exceed 60°/s. The same steer without the handbrake is
 * logged for contrast.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT, type VehicleInput } from '../../src/vehicle/VehicleModel';
import { IS_SYNTHETIC, LEVEL_ID, loadTestLevel, realCourse } from '../helpers/packet';

const ENTRY_SPEED = 10;
const YAW_MIN_DEG_S = 60;
const WINDOW_S = 1.5;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'joyride');
});

/** Cruise at ~10 m/s on the straight, then apply `input` for the window. */
function peakYaw(input: VehicleInput): { entry: number; peak: number; exit: number; maxTilt: number } {
  const throttle = ENTRY_SPEED / sim.cart.tuning.drive.topSpeed; // the governor holds topSpeed × throttle
  sim.reset(sim.level.course.qa.driveStart);
  sim.run(NO_INPUT, 30);
  sim.run({ ...NO_INPUT, throttle }, 6 * 60);
  const entry = sim.cart.forwardSpeed();
  let peak = 0;
  let maxTilt = 0;
  sim.run(input, Math.round(WINDOW_S * 60), (s) => {
    peak = Math.max(peak, Math.abs(s.cart.yawRateDeg()));
    maxTilt = Math.max(maxTilt, s.cart.tiltDeg());
  });
  return { entry, peak, exit: sim.cart.forwardSpeed(), maxTilt };
}

describe(`handbrake drift (${LEVEL_ID})`, () => {
  for (const steer of [1, -1]) {
    it(`handbrake + full steer at 10 m/s yaws over 60°/s within 1.5 s (steer ${steer > 0 ? 'right' : 'left'})`, () => {
      const control = peakYaw({ ...NO_INPUT, steer });
      const drift = peakYaw({ ...NO_INPUT, steer, handbrake: true });
      console.log(
        `handbrake drift ${steer > 0 ? 'right' : 'left'}: entry ${drift.entry.toFixed(2)} m/s, ` +
          `peak yaw ${drift.peak.toFixed(1)}°/s (steer only: ${control.peak.toFixed(1)}°/s), ` +
          `exit ${drift.exit.toFixed(2)} m/s, max tilt ${drift.maxTilt.toFixed(1)}°`,
      );
      expect(drift.entry).toBeGreaterThan(9.5);
      expect(drift.entry).toBeLessThan(10.5);
      expect(drift.peak).toBeGreaterThan(YAW_MIN_DEG_S);
      // Steering alone already clears 60°/s at 10 m/s, so also require the handbrake to add rotation
      // (on a real course's rolling fairway, keep at least most of it).
      expect(drift.peak).toBeGreaterThan(IS_SYNTHETIC ? control.peak : control.peak * realCourse.driftOverSteerRatio);
    });
  }
});
