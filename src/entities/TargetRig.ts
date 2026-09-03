import * as THREE from "three";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "../sim/entities/Target";
import { TRANSFORM_STRIDE } from "../sim/world";

/**
 * Render-only ragdoll targets, built to concept image 05 (the struck caddie) and image 01's form
 * language: flat-shaded, saturated, silhouette-first.
 *
 * Follows GolfClub.ts: a THREE.Group that owns no Rapier body and no authoritative state, posed
 * each frame from a sim snapshot. It never touches a Target or a Rapier body.
 *
 * Eleven InstancedMeshes, one per part name, with instance count equal to the number of targets
 * on the hole. Not thirty-three plain meshes, and not one instanced mesh: the eleven parts have
 * eleven distinct radius/half-height pairs, and a capsule under non-uniform scale stops being a
 * capsule -- its caps distort. This way the draw-call count is eleven no matter how many targets
 * a hole later grows to.
 *
 * There is no knocked-down tint. The collapse is what reads, and a colour change would be a
 * second signal for a state the pose already communicates.
 */

const CAPSULE_RADIAL_SEGMENTS = 8;
const CAPSULE_CAP_SEGMENTS = 4;

/** Muted work-wear against saturated turf, so the silhouette carries the read rather than hue. */
const SKIN = 0xd9a06b;
const SHIRT = 0xe8e4d9;
const TROUSERS = 0x3b4a63;

function materialColour(name: string): number {
  if (name === "head") return SKIN;
  if (name.startsWith("upperLeg") || name.startsWith("lowerLeg") || name === "pelvis") return TROUSERS;
  if (name.startsWith("lowerArm")) return SKIN;
  return SHIRT;
}

export class TargetRig extends THREE.Group {
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Reused per-frame, per the AGENTS.md no-allocation rule. */
  private readonly positionScratch = new THREE.Vector3();
  private readonly quaternionScratch = new THREE.Quaternion();
  private readonly scaleScratch = new THREE.Vector3(1, 1, 1);
  private readonly matrixScratch = new THREE.Matrix4();

  constructor(targetCount: number) {
    super();
    for (const shape of TARGET_PART_SHAPES) {
      const geometry = new THREE.CapsuleGeometry(
        shape.radius,
        shape.halfHeight * 2,
        CAPSULE_CAP_SEGMENTS,
        CAPSULE_RADIAL_SEGMENTS,
      );
      const material = new THREE.MeshStandardMaterial({
        color: materialColour(shape.name),
        roughness: 0.85,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(targetCount, 0));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Ragdoll parts move every frame once down; a stale frustum box would pop them out of view.
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.add(mesh);
    }
  }

  /**
   * `transforms` is the interpolated snapshot: `partCount` entries of
   * (x, y, z, qx, qy, qz, qw), ordered target-major then part-major, exactly as
   * `Sim.syncCurrentTargets` writes it.
   */
  setFromTransforms(transforms: Float32Array, partCount: number): void {
    for (let partIndex = 0; partIndex < PARTS_PER_TARGET; partIndex++) {
      const mesh = this.meshes[partIndex]!;
      for (let targetIndex = 0; targetIndex < mesh.count; targetIndex++) {
        const flat = (targetIndex * PARTS_PER_TARGET + partIndex) * TRANSFORM_STRIDE;
        if (flat + TRANSFORM_STRIDE > partCount * TRANSFORM_STRIDE) break;

        this.positionScratch.set(transforms[flat]!, transforms[flat + 1]!, transforms[flat + 2]!);
        this.quaternionScratch.set(
          transforms[flat + 3]!,
          transforms[flat + 4]!,
          transforms[flat + 5]!,
          transforms[flat + 6]!,
        );
        this.matrixScratch.compose(this.positionScratch, this.quaternionScratch, this.scaleScratch);
        mesh.setMatrixAt(targetIndex, this.matrixScratch);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Frees every instanced geometry, material and instance buffer. AGENTS.md extends the
   * resource-cleanup rule to InstancedMesh buffers explicitly: dispose on teardown, not on
   * process exit.
   */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.clear();
  }
}
