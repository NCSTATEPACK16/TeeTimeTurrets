/**
 * Joyride runs on the Turrets cart's numbers (PR 3 of the shared-cart spec): it reaches 19 to
 * 21 m/s, boost reaches about 24 m/s, and the throttle spools as Turrets' does.
 * 6 s of full throttle (no boost) from qa.driveStart keeps the run on the 261 m proving straight.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { FIXED_DT, physicsConfig } from '../../src/physics/physicsConfig';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const SPEED_MIN = 19;
const SPEED_MAX = 21;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'joyride');
});

describe(`Joyride top speed (${LEVEL_ID})`, () => {
  it('6 s of full throttle ends between 19 and 21 m/s', () => {
    sim.reset(sim.level.course.qa.driveStart);
    sim.run(NO_INPUT, Math.round(0.5 / FIXED_DT));

    const steps = 6 * physicsConfig.fixedHz;
    let maxSpeed = -Infinity;
    let maxRoll = 0;
    let timeTo15 = NaN;
    for (let i = 1; i <= steps; i++) {
      sim.step({ ...NO_INPUT, throttle: 1 });
      const v = sim.cart.forwardSpeed();
      maxSpeed = Math.max(maxSpeed, v);
      maxRoll = Math.max(maxRoll, Math.abs(sim.cart.rollDeg()));
      if (Number.isNaN(timeTo15) && v >= 15) timeTo15 = i * FIXED_DT;
    }
    const finalSpeed = sim.cart.forwardSpeed();
    const p = sim.cart.position();
    console.log(
      `joyride top speed: v(6 s) = ${finalSpeed.toFixed(3)} m/s, max v = ${maxSpeed.toFixed(3)} m/s, ` +
        `0→15 m/s in ${timeTo15.toFixed(2)} s, max |roll| = ${maxRoll.toFixed(2)}°, ended at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
    );
    expect(finalSpeed).toBeGreaterThanOrEqual(SPEED_MIN);
    expect(finalSpeed).toBeLessThanOrEqual(SPEED_MAX);
    expect(maxSpeed).toBeLessThanOrEqual(SPEED_MAX);
  });

  it('boost holds about 24 m/s for 3 s, then the meter is empty and refills in 6 s', () => {
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
    expect(maxBoosted).toBeGreaterThanOrEqual(23);
    expect(maxBoosted).toBeLessThanOrEqual(24.5);
    expect(boostSteps * FIXED_DT).toBeCloseTo(3, 1);
    expect(empty).toBeCloseTo(0, 9);
    expect(half).toBeCloseTo(0.5, 1);
    expect(full).toBeCloseTo(1, 9);
  });

  it('the throttle spools: 25% of the force at once, all of it by 0.6 s, and again after a release', () => {
    const maxForce = sim.cart.tuning.drive.maxForce;
    // Rear wheels carry the motor (RapierCart: engine force on 2 and 3).
    const force = () => ((sim.cart.controller.wheelEngineForce(2) ?? 0) + (sim.cart.controller.wheelEngineForce(3) ?? 0)) / maxForce;
    sim.reset(sim.level.course.qa.driveStart);
    sim.run(NO_INPUT, 30);
    sim.step({ ...NO_INPUT, throttle: 1 });
    const first = force();
    sim.run({ ...NO_INPUT, throttle: 1 }, Math.round(0.6 / FIXED_DT) - 1);
    const at06 = force();
    sim.step(NO_INPUT);
    sim.step({ ...NO_INPUT, throttle: 1 });
    const again = force();
    console.log(`spool: ${first.toFixed(3)} of max force on the first step, ${at06.toFixed(3)} at 0.6 s, ${again.toFixed(3)} after a release`);
    expect(first).toBeGreaterThanOrEqual(0.25);
    expect(first).toBeLessThan(0.3);
    expect(at06).toBeCloseTo(1, 6);
    expect(again).toBeLessThan(0.3);
  });
});
