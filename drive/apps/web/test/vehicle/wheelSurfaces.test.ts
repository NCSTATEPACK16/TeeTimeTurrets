/**
 * M0 gate: "Surface sampler returns the right material under each wheel".
 * The cart is placed on the packet's proving pad, where each wheel rests on a different
 * known material, and the per-wheel contact points must read those materials.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { WHEEL_NAMES, headingToForward } from '@gcs/level-schema';
import { Simulation } from '../../src/core/sim';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { IS_SYNTHETIC, LEVEL_ID, loadTestLevel } from '../helpers/packet';

let sim: Simulation;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
});

describe(`wheel surfaces (${LEVEL_ID})`, () => {
  // The four-material proving pad exists only on the synthetic level (M2 decision).
  it.runIf(IS_SYNTHETIC)('reports each wheel’s own material on the proving pad', () => {
    const pad = sim.level.course.qa.wheelPad;
    if (!pad) throw new Error('dummy-01 must author qa.wheelPad');
    sim.reset(pad);
    sim.run(NO_INPUT, 90);
    const wheels = sim.cart.wheels();
    const center = sim.cart.position();
    const f = headingToForward(pad.headingDeg);
    const right = { x: -f.z, z: f.x };
    const report = wheels.map((w) => `${w.name}=${w.material}`).join(' ');
    console.log(`wheel pad (${pad.x}, ${pad.z}) heading ${pad.headingDeg}: ${report}`);
    expect(wheels.map((w) => w.name)).toEqual([...WHEEL_NAMES]);
    for (const w of wheels) {
      expect(w.inContact, `${w.name} in contact`).toBe(true);
      expect(w.material, w.name).toBe(pad.expected[w.name]);
      // The named wheel really sits at that corner of the cart.
      const dx = w.contactPoint.x - center.x;
      const dz = w.contactPoint.z - center.z;
      const along = dx * f.x + dz * f.z;
      const side = dx * right.x + dz * right.z;
      expect(Math.sign(along), `${w.name} front/rear`).toBe(w.name.startsWith('F') ? 1 : -1);
      expect(Math.sign(side), `${w.name} left/right`).toBe(w.name.endsWith('R') ? 1 : -1);
    }
    expect(new Set(wheels.map((w) => w.material)).size).toBe(4);
  });

  it('reads the probe material under all four wheels wherever the patch is wide enough', () => {
    let checked = 0;
    const skipped: string[] = [];
    for (const probe of sim.level.course.qa.probes) {
      // Precondition from the packet alone: the four nominal wheel spots share the probe's material.
      sim.reset({ x: probe.x, z: probe.z, headingDeg: 0 });
      const nominal = sim.cart.mounts.map((m) => sim.surfaces.materialAt(probe.x + m.x, probe.z + m.z));
      if (!nominal.every((m) => m === probe.material)) {
        skipped.push(`${probe.material}@(${probe.x},${probe.z})`);
        continue;
      }
      sim.run(NO_INPUT, 60);
      // Since M1 the cart floats in water deeper than the stall depth, so its wheels leave the bed there.
      const floats = sim.water.depthAt(probe.x, probe.z) >= sim.cart.tuning.water.stallDepth;
      for (const w of sim.cart.wheels()) {
        if (!floats) expect(w.inContact, `${probe.material} probe: ${w.name} in contact`).toBe(true);
        expect(w.material, `${probe.material} probe: ${w.name}`).toBe(probe.material);
      }
      checked++;
    }
    console.log(`probes: ${checked} checked under all 4 wheels; skipped (patch narrower than the cart): ${skipped.join(', ') || 'none'}`);
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('reads cartpath at every paths.json point and the right surface at every tee, green and pin', () => {
    for (const path of sim.level.paths.paths) {
      for (const [x, , z] of path.points) expect(sim.surfaces.materialAt(x, z)).toBe('cartpath');
    }
    for (const hole of sim.level.holes.holes) {
      expect(sim.surfaces.materialAt(hole.tee.x, hole.tee.z)).toBe('tee');
      expect(sim.surfaces.materialAt(hole.green.x, hole.green.z)).toBe('green');
      expect(sim.surfaces.materialAt(hole.pin.x, hole.pin.z)).toBe('green');
    }
  });
});
