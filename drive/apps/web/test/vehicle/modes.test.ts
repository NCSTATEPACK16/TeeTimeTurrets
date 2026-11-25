/** Mode switching re-applies tuning in place without disturbing the M0 Chill behaviour. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../../src/core/sim';
import { MODES, nextMode } from '../../src/modes/modes';
import { chillTuning, joyrideTuning } from '../../src/vehicle/cartTuning';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { IS_SYNTHETIC, loadTestLevel } from '../helpers/packet';

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
});

function chillRun(): number {
  sim.reset(sim.level.course.qa.driveStart);
  sim.run(NO_INPUT, 30);
  sim.run({ ...NO_INPUT, throttle: 1 }, 10 * 60);
  return sim.cart.forwardSpeed();
}

describe('modes', () => {
  it('toggles between the two modes', () => {
    expect(nextMode('chill')).toBe('joyride');
    expect(nextMode('joyride')).toBe('chill');
    expect(MODES.chill.cart).toBe(chillTuning);
    expect(MODES.joyride.cart).toBe(joyrideTuning);
  });

  it('Chill → Joyride → Chill drives exactly like a fresh Chill cart', () => {
    expect(sim.mode.name).toBe('chill');
    const before = chillRun();
    sim.setMode('joyride');
    expect(sim.cart.tuning).toBe(joyrideTuning);
    expect(sim.cart.controller.wheelMaxSuspensionTravel(0)).toBeCloseTo(joyrideTuning.suspension.maxTravel, 6);
    sim.setMode('chill');
    expect(sim.cart.controller.wheelMaxSuspensionTravel(0)).toBeCloseTo(chillTuning.suspension.maxTravel, 6);
    const after = chillRun();
    console.log(`mode round trip: Chill v(10 s) ${before.toFixed(4)} → ${after.toFixed(4)} m/s`);
    expect(after).toBeCloseTo(before, 6);
  });

  it('rejects a preset that changes chassis geometry', () => {
    expect(() => sim.cart.setTuning({ ...chillTuning, wheelbase: 2 })).toThrow(/geometry/);
  });

  // The four-material proving pad exists only on the synthetic level (M2 decision).
  it.runIf(IS_SYNTHETIC)('applies per-surface grip to each wheel on the proving pad', () => {
    const pad = sim.level.course.qa.wheelPad;
    if (!pad) throw new Error('dummy-01 must author qa.wheelPad');
    sim.reset(pad);
    sim.run(NO_INPUT, 60);
    const grips = [0, 1, 2, 3].map((i) => sim.cart.controller.wheelFrictionSlip(i)!);
    const mats = sim.cart.wheels().map((w) => w.material);
    console.log(`pad grip: ${mats.map((m, i) => `${m} ${grips[i]!.toFixed(3)}`).join(', ')}`);
    expect(new Set(grips.map((g) => g.toFixed(3))).size).toBeGreaterThan(2);
    const bunker = mats.indexOf('bunker');
    const path = mats.indexOf('cartpath');
    expect(grips[bunker]!).toBeLessThan(grips[path]!);
  });
});
