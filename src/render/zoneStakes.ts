import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { courseKitGraph } from "../entities/envGraphs";
import { mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";

/**
 * The arena zone's edge, marked the way a course marks out of bounds (#52): a white stake every
 * `ZONE_STAKE_SPACING_M` along `sim/arenaZone.ts`'s polygon, with a rope between them.
 *
 * The stake is the course kit's `zone_stake` (Stage 5a, `course_kit.json`): a 1.0 m post whose rope
 * eye sits 0.8 m up on its local +z face. Every stake is one instance of one merged draw; the rope
 * is thin cylinders, sagging a little between eyes, merged into a second. No collider: the zone is a
 * rule, not a fence, and the sim owns it.
 */

export const ZONE_STAKE_SPACING_M = 15;
/** The rope eye, in the stake's own space (`courseKitGraphs.test.ts` holds its height). */
const EYE = new THREE.Vector3(0, 0.8, 0.045);
const ROPE_RADIUS_M = 0.015;
const ROPE_SAG_M = 0.12;
const ROPE_COLOUR = 0xf2efe6;

export interface StakePlacement {
  readonly x: number;
  readonly z: number;
  /** Three `rotation.y`, turning the stake's local +x along the edge. */
  readonly yaw: number;
}

/** Stakes every `spacing` metres round a closed polygon, starting at its first point. */
export function placeZoneStakes(polygon: readonly { x: number; z: number }[], spacing = ZONE_STAKE_SPACING_M): StakePlacement[] {
  const stakes: StakePlacement[] = [];
  let carried = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    // rotation.y takes local +x to (cos yaw, -sin yaw).
    const yaw = Math.atan2(-dz, dx);
    for (let d = carried; d < length; d += spacing) {
      stakes.push({ x: a.x + (dx * d) / length, z: a.z + (dz * d) / length, yaw });
    }
    carried = (((carried - length) % spacing) + spacing) % spacing;
  }
  return stakes;
}

export interface ZoneStakes {
  readonly objects: readonly THREE.Object3D[];
  dispose(): void;
}

export function createZoneStakes(
  polygon: readonly { x: number; z: number }[],
  heightAt: (x: number, z: number) => number,
): ZoneStakes {
  const placements = placeZoneStakes(polygon);
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const matrices = placements.map((p) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z),
      new THREE.Quaternion().setFromAxisAngle(up, p.yaw),
      one,
    ),
  );
  const stakes: MergedGraph = mergeGraphInstances(courseKitGraph("zone_stake"), matrices);
  stakes.mesh.name = "zone-stakes";

  // Rope: each span is two cylinders, eye -> sagged midpoint -> next eye.
  const eyes = matrices.map((m) => EYE.clone().applyMatrix4(m));
  const segment = new THREE.CylinderGeometry(ROPE_RADIUS_M, ROPE_RADIUS_M, 1, 4, 1, true);
  const parts: THREE.BufferGeometry[] = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const span = (from: THREE.Vector3, to: THREE.Vector3): void => {
    direction.subVectors(to, from);
    const length = direction.length();
    if (length < 1e-6) return;
    quaternion.setFromUnitVectors(yAxis, direction.normalize());
    middle.addVectors(from, to).multiplyScalar(0.5);
    parts.push(segment.clone().applyMatrix4(new THREE.Matrix4().compose(middle, quaternion, new THREE.Vector3(1, length, 1))));
  };
  const sag = new THREE.Vector3();
  for (let i = 0; i < eyes.length; i++) {
    const a = eyes[i]!;
    const b = eyes[(i + 1) % eyes.length]!;
    sag.addVectors(a, b).multiplyScalar(0.5);
    sag.y -= ROPE_SAG_M;
    span(a, sag);
    span(sag, b);
  }
  segment.dispose();
  const ropeGeometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: ROPE_COLOUR, roughness: 0.9 });
  const rope = new THREE.Mesh(ropeGeometry, ropeMaterial);
  rope.name = "zone-rope";

  return {
    objects: [stakes.mesh, rope],
    dispose(): void {
      stakes.dispose();
      ropeGeometry.dispose();
      ropeMaterial.dispose();
    },
  };
}
