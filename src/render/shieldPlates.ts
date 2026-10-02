import * as THREE from "three";
import type { CartTransform } from "../sim/world";

/**
 * Shield plates (`docs/art/specs/pickups.md`): up to two curved plates orbiting each shielded cart
 * at hull height, in drink cyan, so a shield reads from across a fairway without a HUD number.
 * One plate goes per absorbed hit or per decay, and its shatter is `EffectsLayer.plateBreak`.
 *
 * One `InstancedMesh` holds every plate of every cart: one draw. A hidden plate is scaled to zero.
 */

/** Drink cyan (`kitGraphs.ts` `PICKUP_COLOURS.drink`), not team blue. */
const PLATE_COLOUR = 0x2ec4d0;
const PLATES_PER_CART = 2;
/** Just outside the 0.9 m hull. */
const ORBIT_RADIUS_M = 1.35;
const PLATE_HEIGHT_M = 0.7;
const PLATE_ARC = THREE.MathUtils.degToRad(70);
const ORBIT_RAD_PER_S = 1.5;
/** Above the cart's position (the capsule centre), about the middle of the hull. */
const LIFT_M = 0.55;

export class ShieldPlates {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.CylinderGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly unit = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(carts: number) {
    // An open arc of a cylinder, centred on +z so a yaw of 0 puts the plate in front.
    this.geometry = new THREE.CylinderGeometry(
      ORBIT_RADIUS_M,
      ORBIT_RADIUS_M,
      PLATE_HEIGHT_M,
      8,
      1,
      true,
      -PLATE_ARC / 2,
      PLATE_ARC,
    );
    this.material = new THREE.MeshStandardMaterial({
      color: PLATE_COLOUR,
      emissive: PLATE_COLOUR,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const count = Math.max(1, carts * PLATES_PER_CART);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = "shield-plates";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
  }

  /**
   * Cart `k`'s plates: `shield` of them showing around `cart`, none while `hidden` (dead). Plates
   * sit opposite each other and orbit together.
   */
  place(k: number, cart: CartTransform, shield: number, hidden: boolean, elapsedSeconds: number): void {
    const p = cart.position;
    for (let j = 0; j < PLATES_PER_CART; j++) {
      const i = k * PLATES_PER_CART + j;
      if (i >= this.mesh.count) return;
      if (hidden || j >= shield) {
        this.mesh.setMatrixAt(i, this.matrix.compose(this.position.set(p.x, p.y, p.z), this.rotation.identity(), this.zero));
        continue;
      }
      const yaw = ORBIT_RAD_PER_S * elapsedSeconds + j * Math.PI + k * 0.9;
      this.rotation.setFromAxisAngle(this.up, yaw);
      this.position.set(p.x, p.y + LIFT_M, p.z);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unit));
    }
  }

  /** After every `place` of a frame. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
