import * as THREE from "three";
import { mergeGraph } from "../entities/primitiveGraph";
import type { MergedGraph } from "../entities/primitiveGraph";
import { graphFor } from "../entities/propGraphs";
import type { PropName } from "../entities/propGraphs";
import { toCourseFrame } from "../sim/courseLayout";
import type { PlacedHole } from "../sim/courseTerrain";
import type { CartTransform } from "../sim/world";
import { KnockState } from "./knockState";

/**
 * Tee furniture a cart can bowl over: two tee markers flanking every tee, and a ball washer and a
 * cart-path sign behind it. One `InstancedMesh` per prop kind, matrices rewritten only while
 * something is falling. The rules live in `knockState.ts`; see there for why this is render-only.
 */

/** Metres either side of the tee, as `props.ts` spaces its markers. */
const TEE_MARKER_SPREAD = 2.4;
/** Behind the tee and to each side, clear of the tee sign on the centre line. */
const FURNITURE_BACK = 4.5;
const FURNITURE_SIDE = 3;

interface Placed {
  kind: PropName;
  x: number;
  z: number;
  yaw: number;
}

const KINDS: readonly PropName[] = ["tee_marker", "ball_washer", "cart_path_sign"];

/** Every knockable on the course, in course coordinates. Exported for the smoke test. */
export function placeKnockables(holes: readonly PlacedHole[]): Placed[] {
  const out: Placed[] = [];
  const tee = { x: 0, z: 0 };
  const ahead = { x: 0, z: 0 };
  for (const hole of holes) {
    const spec = hole.spec;
    toCourseFrame(hole.placement, spec.tee.x, spec.tee.z, tee);
    const toward = spec.control[1] ?? spec.cup;
    toCourseFrame(hole.placement, toward.x, toward.z, ahead);
    const heading = Math.atan2(ahead.z - tee.z, ahead.x - tee.x);
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    // rotation.y takes local +z to (sin yaw, cos yaw): face along the heading, as the tee sign does.
    const yaw = Math.atan2(fx, fz);
    for (const side of [-1, 1]) {
      out.push({ kind: "tee_marker", x: tee.x - fz * side * TEE_MARKER_SPREAD, z: tee.z + fx * side * TEE_MARKER_SPREAD, yaw });
    }
    out.push({
      kind: "ball_washer",
      x: tee.x - fx * FURNITURE_BACK - fz * FURNITURE_SIDE,
      z: tee.z - fz * FURNITURE_BACK + fx * FURNITURE_SIDE,
      yaw,
    });
    out.push({
      kind: "cart_path_sign",
      x: tee.x - fx * FURNITURE_BACK + fz * FURNITURE_SIDE,
      z: tee.z - fz * FURNITURE_BACK - fx * FURNITURE_SIDE,
      yaw,
    });
  }
  return out;
}

interface KindMesh {
  readonly merged: MergedGraph;
  readonly mesh: THREE.InstancedMesh;
  /** Index into the shared `KnockState` for each instance. */
  readonly members: number[];
}

export class Knockables {
  readonly group = new THREE.Group();
  private readonly state: KnockState;
  private readonly kinds: KindMesh[] = [];
  private readonly baseY: Float32Array;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly tip = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly unit = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly prev: Float32Array;
  private readonly seen: Uint8Array;

  /** `onKnock` gets each prop's position as it goes over, for a dust puff and a clatter. */
  constructor(
    holes: readonly PlacedHole[],
    private readonly heightAt: (x: number, z: number) => number,
    cartCount: number,
    private readonly onKnock: (x: number, y: number, z: number) => void,
  ) {
    const placed = placeKnockables(holes);
    this.state = new KnockState(placed);
    this.baseY = Float32Array.from(placed, (p) => heightAt(p.x, p.z));
    this.prev = new Float32Array(cartCount * 2);
    this.seen = new Uint8Array(cartCount);
    for (const kind of KINDS) {
      const members: number[] = [];
      placed.forEach((p, i) => {
        if (p.kind === kind) members.push(i);
      });
      if (members.length === 0) continue;
      // No contact shade: it is baked at the base, and a prop lying on its side would wear it as a
      // dark band down its length.
      const merged = mergeGraph(graphFor(kind), {}, { contactShade: false });
      const mesh = new THREE.InstancedMesh(merged.mesh.geometry, merged.mesh.material, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false; // instances span the course
      this.kinds.push({ merged, mesh, members });
      this.group.add(mesh);
    }
    this.writeMatrices();
  }

  /** One cart's frame: knocks over what it drives through. `index` is its rig index. */
  cart(index: number, transform: CartTransform, hidden: boolean, dt: number): void {
    const p = transform.position;
    const o = index * 2;
    if (hidden || dt <= 0 || this.seen[index] === 0) {
      this.seen[index] = hidden ? 0 : 1;
      this.prev[o] = p.x;
      this.prev[o + 1] = p.z;
      return;
    }
    const vx = (p.x - this.prev[o]!) / dt;
    const vz = (p.z - this.prev[o + 1]!) / dt;
    this.prev[o] = p.x;
    this.prev[o + 1] = p.z;
    this.state.pass(p.x, p.z, vx, vz, (i) => this.onKnock(this.state.x[i]!, this.baseY[i]!, this.state.z[i]!));
  }

  update(dt: number): void {
    if (this.state.update(dt)) this.writeMatrices();
  }

  private writeMatrices(): void {
    const s = this.state;
    for (const kind of this.kinds) {
      kind.members.forEach((i, slot) => {
        const x = s.x[i]! + s.slideX[i]!;
        const z = s.z[i]! + s.slideZ[i]!;
        this.position.set(x, this.heightAt(x, z), z);
        this.quat.setFromAxisAngle(this.up, s.yaw[i]!);
        if (s.tilt[i]! > 0) {
          // (fz, 0, -fx) x up = (fx, 0, fz): a positive turn about it tips the top along the fall.
          this.axis.set(s.fallZ[i]!, 0, -s.fallX[i]!);
          this.tip.setFromAxisAngle(this.axis, s.tilt[i]!);
          this.quat.premultiply(this.tip);
        }
        kind.mesh.setMatrixAt(slot, this.matrix.compose(this.position, this.quat, this.unit));
      });
      kind.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const kind of this.kinds) {
      kind.mesh.dispose();
      kind.merged.dispose();
    }
    this.group.clear();
  }
}
