import * as THREE from "three";
import { POOL_SIZE } from "../sim/entities/BallPool";
import { POOL_TRANSFORM_STRIDE } from "../sim/world";
import { BALL_RADIUS } from "../sim/entities/ballShape";

/**
 * The pooled combat balls, which cart mode fires and which nothing drew before this: the player
 * pressed fire and a ragdoll fell over some distance away with nothing having visibly travelled
 * between them.
 *
 * One InstancedMesh of POOL_SIZE. Inactive slots are scaled to zero rather than removed, so the
 * instance count never changes and no buffer is reallocated mid-round.
 *
 * Render-only, like GolfClub and TargetRig: no Rapier body, no authoritative state.
 */

/** Re-exported from the sim's ballShape.ts leaf module -- see its docstring for why the sim
 *  owns this. Also the course ball's radius (src/render/scene.ts) and the gate's ball subject
 *  (tools/gate/gateScene.ts) -- exported so both import it instead of carrying their own copy. */
export { BALL_RADIUS };

/** Segment counts for the course ball's own sphere geometry (src/render/scene.ts) and the
 *  gate's ball subject (tools/gate/gateScene.ts) -- shared so a tesselation change to one
 *  can't silently drift out of step with the other. Not used by this file's own swarm mesh,
 *  which has its own coarser tesselation below. */
export const BALL_WIDTH_SEGMENTS = 20;
export const BALL_HEIGHT_SEGMENTS = 16;

const ZERO_SCALE = 0.0001;

export class BallSwarm extends THREE.Group {
  private readonly mesh: THREE.InstancedMesh;
  private readonly positionScratch = new THREE.Vector3();
  private readonly quaternionScratch = new THREE.Quaternion();
  private readonly scaleScratch = new THREE.Vector3();
  private readonly matrixScratch = new THREE.Matrix4();

  constructor() {
    super();
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL_SIZE);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // A ball in flight leaves any precomputed bounds immediately.
    this.mesh.frustumCulled = false;
    this.add(this.mesh);
  }

  /** `transforms` is the interpolated pool snapshot, POOL_TRANSFORM_STRIDE floats per slot. */
  setFromTransforms(transforms: Float32Array): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const active = transforms[flat + 7] === 1;
      const scale = active ? 1 : ZERO_SCALE;
      this.positionScratch.set(transforms[flat]!, transforms[flat + 1]!, transforms[flat + 2]!);
      this.quaternionScratch.set(
        transforms[flat + 3]!,
        transforms[flat + 4]!,
        transforms[flat + 5]!,
        transforms[flat + 6]!,
      );
      this.scaleScratch.set(scale, scale, scale);
      this.matrixScratch.compose(this.positionScratch, this.quaternionScratch, this.scaleScratch);
      this.mesh.setMatrixAt(i, this.matrixScratch);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
    this.mesh.dispose();
    this.clear();
  }
}
