/** The Turrets cart in free drive, in Node: its wheels sit on drive's mounts and pose from the physics. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three/webgpu';
import { Simulation } from '../../src/core/sim';
import { CartView, TURRET_NODE } from '../../src/vehicle/CartView';
import type { WheelState } from '../../src/vehicle/VehicleModel';
import { loadTestLevel } from '../helpers/packet';

let sim: Simulation;
let view: CartView;
beforeAll(async () => {
  sim = await Simulation.create(await loadTestLevel());
  view = new CartView(sim.cart.tuning, sim.cart.mounts);
});

const centre = (i: number) => view.root.worldToLocal(view.wheelFor[i]!.getWorldPosition(new Vector3()));

describe('CartView', () => {
  it('puts each model wheel on its mount at rest length, matched by position', () => {
    const rest = sim.cart.tuning.suspension.restLength;
    const wheels = sim.cart.wheels().map((w) => ({ ...w, suspensionLength: rest, steering: 0, rotation: 0 }));
    view.update(new Vector3(), new Quaternion(), wheels);
    view.root.updateMatrixWorld(true);
    sim.cart.mounts.forEach((m, i) => {
      const c = centre(i);
      expect(c.x, `mount ${i} x`).toBeCloseTo(m.x, 2);
      expect(c.y, `mount ${i} y`).toBeCloseTo(m.y - rest, 2);
      expect(c.z, `mount ${i} z`).toBeCloseTo(m.z, 2);
    });
    // The π turn puts Blender's left wheels on drive's right: drive's FL (−X, −Z) is the model's wheel_fr.
    expect(view.wheelFor.map((w) => w.name)).toEqual(['wheel_fr', 'wheel_fl', 'wheel_rr', 'wheel_rl']);
    expect(view.model.getObjectByName(TURRET_NODE)!.visible).toBe(false);
  });

  it('lifts a compressed wheel, steers left for positive steering, and rolls the top forward', () => {
    const rest = sim.cart.tuning.suspension.restLength;
    const base = sim.cart.wheels().map((w) => ({ ...w, suspensionLength: rest, steering: 0, rotation: 0 }));
    view.update(new Vector3(), new Quaternion(), base);
    view.root.updateMatrixWorld(true);
    const y0 = centre(0).y;
    const posed: WheelState[] = base.map((w, i) => (i === 0 ? { ...w, suspensionLength: rest - 0.1, steering: 0.3, rotation: 0.5 } : w));
    view.update(new Vector3(), new Quaternion(), posed);
    view.root.updateMatrixWorld(true);
    expect(centre(0).y - y0).toBeCloseTo(0.1, 4);
    // The axle (the tyre's local Y) turns left with positive steering: its +X end swings toward −Z.
    const wheel = view.wheelFor[0]!;
    const axle = new Vector3(0, 1, 0).applyQuaternion(wheel.getWorldQuaternion(new Quaternion()));
    if (axle.x < 0) axle.negate();
    expect(axle.x).toBeCloseTo(Math.cos(0.3), 4);
    expect(axle.z).toBeCloseTo(-Math.sin(0.3), 4);
    // Rolling forward moves the tyre's top toward −Z. The rest pose (−π/2 about Z) puts the
    // tyre's local −X on top.
    const noSteer = posed.map((w, i) => (i === 0 ? { ...w, steering: 0 } : w));
    view.update(new Vector3(), new Quaternion(), noSteer);
    view.root.updateMatrixWorld(true);
    const top = new Vector3(-0.3, 0, 0).applyQuaternion(wheel.getWorldQuaternion(new Quaternion()));
    expect(top.y).toBeCloseTo(0.3 * Math.cos(0.5), 4);
    expect(top.z).toBeCloseTo(-0.3 * Math.sin(0.5), 4);
  });
});
