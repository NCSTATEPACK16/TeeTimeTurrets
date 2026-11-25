/**
 * M1 gate: "Headless: entering 0.5 m water at 10 m/s slows the cart under 4 m/s within 3 s".
 * Joyride (Chill can't reach 10 m/s), launched at 10 m/s from qa.waterEntry with the pedal
 * held to keep 10 m/s. The clock starts when the first wheel is over water.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { FIXED_DT } from '../../src/physics/physicsConfig';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { LEVEL_ID, loadTestLevel } from '../helpers/packet';

const ENTRY_SPEED = 10;
const SLOW_TO = 4;
const WITHIN_S = 3;

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel(), 'joyride');
});

describe(`water entry (${LEVEL_ID})`, () => {
  it('0.5 m water at 10 m/s slows the cart under 4 m/s within 3 s', (ctx) => {
    const entry = sim.level.course.qa.waterEntry;
    if (!entry) return ctx.skip();
    const throttle = ENTRY_SPEED / sim.cart.tuning.drive.topSpeed;
    sim.launch(entry, ENTRY_SPEED);

    let entered = -1;
    let entrySpeed = NaN;
    let slowAt = NaN;
    let maxDepth = 0;
    for (let i = 1; i <= 8 * 60; i++) {
      sim.step({ ...NO_INPUT, throttle });
      const wet = sim.cart.dynamics().some((w) => w.waterDepth > 0);
      if (entered < 0 && wet) {
        entered = i;
        entrySpeed = sim.cart.forwardSpeed();
      }
      if (entered >= 0) {
        maxDepth = Math.max(maxDepth, sim.cart.waterState().depth);
        if (Number.isNaN(slowAt) && sim.cart.forwardSpeed() < SLOW_TO) slowAt = (i - entered) * FIXED_DT;
        if (i - entered > 5 * 60) break;
      }
    }
    const settled = sim.cart.forwardSpeed();
    console.log(
      `water entry: entry ${entrySpeed.toFixed(2)} m/s, under ${SLOW_TO} m/s after ${slowAt.toFixed(2)} s, ` +
        `wading speed after 5 s ${settled.toFixed(2)} m/s, max mean wheel depth ${maxDepth.toFixed(2)} m`,
    );
    expect(entered).toBeGreaterThan(0);
    expect(entrySpeed).toBeGreaterThan(9.5);
    expect(maxDepth).toBeGreaterThan(0.45);
    expect(slowAt).toBeLessThanOrEqual(WITHIN_S);
    expect(settled).toBeLessThan(SLOW_TO); // stays slow while wading with the pedal down
  });
});
