import { Group, type Mesh, Quaternion, Vector3 } from 'three/webgpu';
// Shared data, not modules: the Turrets cart and its rider as authored in Blender (art/cart_v3_kit.py,
// art/rider_kit.py). Built here with drive's own WebGPU builder; see cartGraph.ts.
import cartJson from '../../../../../src/entities/graphs/cart.json';
import driverJson from '../../../../../src/entities/graphs/driver.json';
import { buildGraph, drawBySlot, type BuiltGraph, type PrimitiveGraph, type SlotDraw } from './cartGraph';
import type { CartTuning } from './cartTuning';
import type { Vec3, WheelState } from './VehicleModel';

const CART_GRAPH = cartJson as unknown as PrimitiveGraph;
const DRIVER_GRAPH = driverJson as unknown as PrimitiveGraph;

/** The model's wheels (each with its rim as a child). Matched to drive's mounts by position, not name. */
export const CART_WHEELS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
/** Everything the turret is hangs under this node; free drive hides it. */
export const TURRET_NODE = 'turret_pivot';
/** Nodes CartView poses or hides at runtime; drawBySlot merges everything else into them. */
export const CART_POSED: readonly string[] = [...CART_WHEELS, TURRET_NODE];

const Y = new Vector3(0, 1, 0);

/**
 * The Turrets cart without its turret: the cart and rider graphs, one draw per slot per posed part
 * (19 draws). The model faces +Z and drive's chassis faces -Z, so the model turns by π, and it is
 * offset so its wheel centres sit on drive's mounts at rest length. Each frame the wheels steer,
 * spin, and ride the suspension from the physics state.
 */
export class CartView {
  readonly root = new Group();
  /** The model in drive's chassis frame: turned by π and offset onto the mounts. */
  readonly model = new Group();
  private readonly cart: BuiltGraph;
  private readonly rider: BuiltGraph;
  private readonly draws: SlotDraw[] = [];
  /** wheelFor[i] is the model wheel on drive's mount i (WHEEL_NAMES order: FL, FR, RL, RR). */
  readonly wheelFor: Mesh[] = [];
  private readonly restY: number[] = [];
  private readonly restQuat: Quaternion[] = [];
  private readonly steerQ = new Quaternion();
  private readonly spinQ = new Quaternion();

  constructor(
    private readonly tuning: CartTuning,
    mounts: readonly Vec3[],
  ) {
    this.root.name = 'cart';
    this.cart = buildGraph(CART_GRAPH);
    this.rider = buildGraph(DRIVER_GRAPH);
    this.model.add(this.cart.root, this.rider.root);
    this.root.add(this.model);
    this.draws.push(drawBySlot(this.cart, CART_POSED), drawBySlot(this.rider, []));
    this.node(TURRET_NODE).visible = false;

    // Turn, then place: the mean offset from each model wheel centre to its mount's rest centre.
    this.model.rotation.y = Math.PI;
    this.model.updateMatrixWorld(true);
    const centres = CART_WHEELS.map((n) => this.centreInRoot(n));
    const offset = new Vector3();
    for (const mount of mounts) {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, k) => {
        const d = Math.hypot(c.x - mount.x, c.z - mount.z);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (this.wheelFor.includes(this.node(CART_WHEELS[best]!))) throw new Error('CartView: two mounts matched one model wheel');
      const wheel = this.node(CART_WHEELS[best]!);
      this.wheelFor.push(wheel);
      this.restY.push(wheel.position.y);
      this.restQuat.push(wheel.quaternion.clone());
      const c = centres[best]!;
      offset.x += (mount.x - c.x) / mounts.length;
      offset.y += (mount.y - tuning.suspension.restLength - c.y) / mounts.length;
      offset.z += (mount.z - c.z) / mounts.length;
    }
    this.model.position.copy(offset);
  }

  /** The model wheel centre in the root's frame (drive's chassis frame), before the offset. */
  private centreInRoot(name: string): Vector3 {
    this.root.updateMatrixWorld(true);
    const p = this.node(name).getWorldPosition(new Vector3());
    return this.root.worldToLocal(p);
  }

  private node(name: string): Mesh {
    const n = this.cart.named.get(name);
    if (!n) throw new Error(`cart graph is missing the node "${name}" free drive poses`);
    return n;
  }

  /** Canopy and the rider's shirt, as Turrets paints a team cart (src/render/teamColors.ts). */
  setPaint(canopy: number, shirt: number): void {
    this.cart.setSlotColor('canopy', canopy);
    this.rider.setSlotColor('shirt', shirt);
  }

  /** Place the cart (interpolated pose) and pose each wheel from the physics state. No allocation. */
  update(position: Vector3, quaternion: Quaternion, wheels: readonly WheelState[]): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    const rest = this.tuning.suspension.restLength;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]!;
      const wheel = this.wheelFor[i]!;
      // The model's frame differs from the chassis frame by a turn about Y, so heights carry over.
      wheel.position.y = this.restY[i]! + (rest - w.suspensionLength);
      // Rapier's positive steering turns left: +Y in both frames, since the π turn is about Y too.
      this.steerQ.setFromAxisAngle(Y, w.steering);
      // The tyre's own axis is its local Y, which the π turn points along drive's −X; Rapier's
      // rotation grows rolling toward −Z, which is +rotation about that axis.
      this.spinQ.setFromAxisAngle(Y, w.rotation);
      wheel.quaternion.copy(this.steerQ).multiply(this.restQuat[i]!).multiply(this.spinQ);
    }
  }

  dispose(): void {
    for (const d of this.draws) d.dispose();
    this.cart.dispose();
    this.rider.dispose();
  }
}
