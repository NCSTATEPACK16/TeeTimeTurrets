import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial, type Quaternion, type Vector3 } from 'three/webgpu';
import { color } from 'three/tsl';
import { envConfig } from '../env/envConfig';
import type { CartTuning } from './cartTuning';
import type { Vec3, WheelState } from './VehicleModel';

function solid(hex: string, roughness = 0.6): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness, metalness: 0 });
  m.colorNode = color(hex);
  return m;
}

/** Gray-box cart: the chassis box (same size as the collider), roof on posts, seat and four wheels. */
export class CartView {
  readonly root = new Group();
  private readonly wheelPivots: Group[] = [];
  private readonly wheelSpins: Group[] = [];

  constructor(
    tuning: CartTuning,
    private readonly mounts: readonly Vec3[],
  ) {
    const c = envConfig.cart;
    const { halfWidth: hx, halfHeight: hy, halfLength: hz } = tuning.body;
    this.root.name = 'cart';

    const body = new Mesh(new BoxGeometry(2 * hx, 2 * hy, 2 * hz), solid(c.body));
    this.root.add(body);
    // Hood at the front (-Z) so the heading is obvious from the chase camera.
    const hood = new Mesh(new BoxGeometry(2 * hx * 0.9, 0.18, 0.5), solid(c.body));
    hood.position.set(0, hy + 0.09, -hz + 0.25);
    const seat = new Mesh(new BoxGeometry(2 * hx * 0.85, 0.5, 0.5), solid(c.seat, 0.8));
    seat.position.set(0, hy + 0.25, 0.25);
    const roofY = hy + 1.25;
    const roof = new Mesh(new BoxGeometry(2 * hx + 0.1, 0.06, 2 * hz * 0.85), solid(c.roof));
    roof.position.set(0, roofY, 0.05);
    this.root.add(hood, seat, roof);
    const postMat = solid(c.seat);
    for (const [px, pz] of [
      [-hx + 0.05, -hz * 0.55],
      [hx - 0.05, -hz * 0.55],
      [-hx + 0.05, hz * 0.8],
      [hx - 0.05, hz * 0.8],
    ] as const) {
      const post = new Mesh(new BoxGeometry(0.05, roofY - hy, 0.05), postMat);
      post.position.set(px, (roofY + hy) / 2, pz);
      this.root.add(post);
    }

    const r = tuning.wheelRadius;
    const tire = new CylinderGeometry(r, r, 0.2, 18).rotateZ(Math.PI / 2);
    const hub = new BoxGeometry(0.21, r * 1.2, 0.08);
    const tireMat = solid(c.tire, 0.9);
    const hubMat = solid(c.hub, 0.4);
    for (const mount of mounts) {
      const pivot = new Group();
      pivot.position.set(mount.x, mount.y - tuning.suspension.restLength, mount.z);
      const spin = new Group();
      spin.add(new Mesh(tire, tireMat), new Mesh(hub, hubMat));
      pivot.add(spin);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
    }
  }

  /** Place the cart (interpolated pose) and pose each wheel from the physics state. */
  update(position: Vector3, quaternion: Quaternion, wheels: readonly WheelState[]): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    for (const [i, w] of wheels.entries()) {
      const pivot = this.wheelPivots[i]!;
      pivot.position.y = this.mounts[i]!.y - w.suspensionLength;
      pivot.rotation.y = w.steering; // Rapier: positive steering turns left, same as +Y rotation
      this.wheelSpins[i]!.rotation.x = -w.rotation; // Rapier's rotation grows when rolling toward -Z
    }
  }
}
