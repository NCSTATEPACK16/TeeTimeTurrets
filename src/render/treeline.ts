/**
 * The band of trees beyond County Home Road, so the horizon continues past the boundary.
 *
 * **Scenery, and nothing but.** The cart is held north of the road by `courseBarrier.ts`, so every
 * tree here stands on ground no player reaches. It is never collided with, never replicated and
 * never read by `src/sim/**` -- which is what puts it on the decorative side of the `AGENTS.md`
 * rule, and why it can be a render-only module with no simulation counterpart.
 *
 * Without it the course ends at a mown edge with sky behind it: the barrier stops the cart at a
 * line the player cannot see a reason for. Trees are the reason.
 *
 * Follows `Trees.ts` exactly -- one merged geometry, one `InstancedMesh`, one `dispose()` freeing
 * geometry, material and mesh -- and grows the same tree by importing its builder rather than
 * describing a second one.
 */

import * as THREE from "three";
import { BIOMES } from "./biomes";
import { buildTreeGeometry } from "./Trees";
import { hashChannel, mulberry32 } from "../sim/rng";
import { metresNorthOf } from "../sim/courseBarrier";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { Bounds } from "../sim/courseLayout";

/** How far south of the road the band starts and ends, in metres. Clear of the verge, deep enough
 *  to read as a wood rather than a hedge. */
const NEAR_M = 12;
const FAR_M = 90;

/** Along-road spacing of candidate positions. Coarser than `Trees.ts`'s 6 m cell: this is a
 *  horizon, not cover, and every instance here is drawn for every frame the road is in shot. */
const STEP_M = 9;

/** How far past each end of the road the band runs, so it does not stop in mid-air at the corners. */
const OVERHANG_M = 160;

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.5;
const MAX_TREES = 1400;

/** The channel the band draws from. 0..3 belong to the hole (height, sand, layout, trees). */
const TREELINE_CHANNEL = 6;

export interface Treeline {
  readonly mesh: THREE.InstancedMesh | null;
  readonly count: number;
  dispose(): void;
}

/**
 * `heightAt` is the course's, so the band sits on the same ground the player drives to the edge of.
 * Sample points are clamped into `bounds` before asking for a height -- past the heightfield there
 * are no heights, and a tree at whatever a lookup returns out there would float or sink.
 */
export function createTreeline(
  line: SouthBoundary,
  bounds: Bounds,
  heightAt: (x: number, z: number) => number,
  seed: number,
): Treeline {
  // Parkland, because the road runs along the parkland end of the course and the band is read
  // against holes 1, 9, 10 and 18.
  const palette = BIOMES.parkland;
  const random = mulberry32(hashChannel(seed, 0, TREELINE_CHANNEL));

  const dx = line.b.x - line.a.x;
  const dz = line.b.z - line.a.z;
  const length = Math.hypot(dx, dz);
  // Unit vectors along the road and along its southward normal.
  const ax = dx / length;
  const az = dz / length;
  const nx = dz / length;
  const nz = -dx / length;

  const matrices: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  for (let s = -OVERHANG_M; s <= length + OVERHANG_M && matrices.length < MAX_TREES; s += STEP_M) {
    // Two to four trees per step, scattered through the depth of the band, so the edge of the wood
    // is ragged rather than a fence.
    const perStep = 2 + Math.floor(random() * 3);
    for (let k = 0; k < perStep && matrices.length < MAX_TREES; k++) {
      const along = s + random() * STEP_M;
      const depth = NEAR_M + random() * (FAR_M - NEAR_M);
      const x = line.a.x + ax * along + nx * depth;
      const z = line.a.z + az * along + nz * depth;

      // Belt and braces: the normal above should point south, and a tree on the playing side of the
      // road would be a tree in the fairway.
      if (metresNorthOf(line, x, z) > 0) continue;

      const sampleX = Math.min(bounds.maxX, Math.max(bounds.minX, x));
      const sampleZ = Math.min(bounds.maxZ, Math.max(bounds.minZ, z));
      const y = heightAt(sampleX, sampleZ);
      if (!Number.isFinite(y)) continue;

      const height = palette.treeHeight * (SCALE_MIN + random() * (SCALE_MAX - SCALE_MIN));
      position.set(x, y, z);
      quaternion.setFromAxisAngle(axis, random() * Math.PI * 2);
      scale.set(height, height, height);
      matrices.push(matrix.clone().compose(position, quaternion, scale));
    }
  }

  if (matrices.length === 0) return { mesh: null, count: 0, dispose: () => {} };

  const geometry = buildTreeGeometry(palette);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.computeBoundingSphere();

  return {
    mesh,
    count: matrices.length,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
