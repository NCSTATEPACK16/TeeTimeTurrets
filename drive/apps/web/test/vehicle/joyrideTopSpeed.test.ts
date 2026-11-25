/**
 * M1 gate: "Headless: Joyride reaches 12.5 to 14 m/s".
 * 12 s of full throttle (no boost) from qa.driveStart. 12 s keeps the run on the 261 m
 * proving straight; 20 s at ~13 m/s would reach the curve.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { FIXED_DT, physicsConfig } from '../../src/physics/physicsConfig';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const SPEED_MIN = 12.5;
const SPEED_MAX = 14.0;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'joyride');
});

describe(`Joyride top speed (${LEVEL_ID})`, () => {
  it('12 s of full throttle ends between 12.5 and 14 m/s', () => {
    sim.reset(sim.level.course.qa.driveStart);
    sim.run(NO_INPUT, Math.round(0.5 / FIXED_DT));

    const steps = 12 * physicsConfig.fixedHz;
    let maxSpeed = -Infinity;
    let maxRoll = 0;
    let timeTo13 = NaN;
    for (let i = 1; i <= steps; i++) {
      sim.step({ ...NO_INPUT, throttle: 1 });
      const v = sim.cart.forwardSpeed();
      maxSpeed = Math.max(maxSpeed, v);
      maxRoll = Math.max(maxRoll, Math.abs(sim.cart.rollDeg()));
      if (Number.isNaN(timeTo13) && v >= 13) timeTo13 = i * FIXED_DT;
    }
    const finalSpeed = sim.cart.forwardSpeed();
    const p = sim.cart.position();
    console.log(
      `joyride top speed: v(12 s) = ${finalSpeed.toFixed(3)} m/s, max v = ${maxSpeed.toFixed(3)} m/s, ` +
        `0→13 m/s in ${timeTo13.toFixed(2)} s, max |roll| = ${maxRoll.toFixed(2)}°, ended at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
    );
    expect(finalSpeed).toBeGreaterThanOrEqual(SPEED_MIN);
    expect(finalSpeed).toBeLessThanOrEqual(SPEED_MAX);
    expect(maxSpeed).toBeLessThanOrEqual(SPEED_MAX);
  });

  it('boost holds 15 m/s for 3 s, then the meter is empty and refills in 6 s', () => {
    sim.reset(sim.level.course.qa.driveStart);
    sim.run(NO_INPUT, 30);
    sim.run({ ...NO_INPUT, throttle: 1 }, 4 * 60);
    let maxBoosted = 0;
    let boostSteps = 0;
    sim.run({ ...NO_INPUT, throttle: 1, boost: true }, 4 * 60, (s) => {
      maxBoosted = Math.max(maxBoosted, s.cart.forwardSpeed());
      if (s.cart.isBoosting()) boostSteps++;
    });
    const empty = sim.cart.boostMeter();
    sim.run({ ...NO_INPUT, throttle: 1 }, 3 * 60);
    const half = sim.cart.boostMeter();
    sim.run({ ...NO_INPUT, throttle: 1 }, 3 * 60);
    const full = sim.cart.boostMeter();
    console.log(
      `boost: max v ${maxBoosted.toFixed(2)} m/s, boosted ${(boostSteps * FIXED_DT).toFixed(2)} s, ` +
        `meter ${empty.toFixed(2)} → ${half.toFixed(2)} (3 s) → ${full.toFixed(2)} (6 s)`,
    );
    expect(maxBoosted).toBeGreaterThanOrEqual(14.5);
    expect(maxBoosted).toBeLessThanOrEqual(15.3);
    expect(boostSteps * FIXED_DT).toBeCloseTo(3, 1);
    expect(empty).toBeCloseTo(0, 9);
    expect(half).toBeCloseTo(0.5, 1);
    expect(full).toBeCloseTo(1, 9);
  });
});
