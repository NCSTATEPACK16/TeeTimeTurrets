/**
 * M0 gate: "Headless drive: 20 s full throttle reaches 6.4 to 7.0 m/s, roll stays under 35°".
 * Runs on the packet's qa.driveStart (a straight, nearly flat run) with no steering.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, physicsConfig } from '../../src/physics/physicsConfig';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const SPEED_MIN = 6.4;
const SPEED_MAX = 7.0;
const ROLL_LIMIT_DEG = 35;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
});

describe(`headless drive (${LEVEL_ID})`, () => {
  it('20 s of full throttle ends between 6.4 and 7.0 m/s with roll under 35°', () => {
    sim.reset(sim.level.course.qa.driveStart);
    sim.run(NO_INPUT, Math.round(0.5 / FIXED_DT)); // settle on the suspension

    const steps = 20 * physicsConfig.fixedHz;
    let maxSpeed = -Infinity;
    let maxRoll = 0;
    let maxTilt = 0;
    let allWheelsDown = 0;
    let timeTo6 = NaN;
    let stepMsTotal = 0;
    for (let i = 1; i <= steps; i++) {
      sim.step({ ...NO_INPUT, throttle: 1 });
      const v = sim.cart.forwardSpeed();
      maxSpeed = Math.max(maxSpeed, v);
      maxRoll = Math.max(maxRoll, Math.abs(sim.cart.rollDeg()));
      maxTilt = Math.max(maxTilt, sim.cart.tiltDeg());
      if (sim.cart.wheels().every((w) => w.inContact)) allWheelsDown++;
      if (Number.isNaN(timeTo6) && v >= 6) timeTo6 = i * FIXED_DT;
      stepMsTotal += sim.lastStepMs;
    }
    const finalSpeed = sim.cart.forwardSpeed();
    const p = sim.cart.position();
    console.log(
      `headless drive: v(20 s) = ${finalSpeed.toFixed(3)} m/s, max v = ${maxSpeed.toFixed(3)} m/s, ` +
        `max |roll| = ${maxRoll.toFixed(2)}°, max tilt = ${maxTilt.toFixed(2)}°, ` +
        `0→6 m/s in ${timeTo6.toFixed(2)} s, all wheels down ${((100 * allWheelsDown) / steps).toFixed(1)}% of steps, ` +
        `ended at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), mean step ${(stepMsTotal / steps).toFixed(3)} ms`,
    );

    expect(finalSpeed).toBeGreaterThanOrEqual(SPEED_MIN);
    expect(finalSpeed).toBeLessThanOrEqual(SPEED_MAX);
    expect(maxSpeed).toBeLessThanOrEqual(SPEED_MAX);
    expect(maxRoll).toBeLessThan(ROLL_LIMIT_DEG);
    expect(allWheelsDown / steps).toBeGreaterThanOrEqual(0.95);
  });
});
