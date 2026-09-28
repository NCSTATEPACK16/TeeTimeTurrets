import * as THREE from "three";
import { hashChannel, mulberry32 } from "../sim/rng";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces, SurfaceWeights } from "../sim/surfaces";
import type { QualityPreset } from "./quality";

/**
 * Tufts of long grass round the camera: a square of `GRASS_CELL_M` cells out to `GRASS_REACH_M`
 * each way, following the camera one cell at a time.
 *
 * One instanced draw. Each cell owns a fixed run of instance slots; when the camera crosses into a
 * new cell, the row or column of cells it left is handed to the one it entered and only those are
 * re-scattered. A cell's scatter is seeded from its own coordinates, so driving away and back
 * grows the same tufts.
 *
 * Grass grows in the rough and on the fairway's edge, never on a green, in sand or in water
 * (`grassAllowed`, from the sim's own surface weights). The vertex shader sways the tips in the
 * wind and shrinks tufts to nothing toward the edge of the reach, so the square never shows.
 */

export const GRASS_CELL_M = 16;
export const GRASS_REACH_M = 48;
/** Tufts per square metre at the preset's full density. */
const CLUMPS_PER_M2 = 0.5;
const BLADES_PER_CLUMP = 5;
const BLADE_HEIGHT_M = 0.42;
const BLADE_WIDTH_M = 0.07;
/** RNG channel for the carpet's scatter. See `courseTrees.ts` for the channels below it. */
const GRASS_CHANNEL = 9;
const SIDE = (2 * GRASS_REACH_M) / GRASS_CELL_M;

/** Where a tuft may grow: rough, or the fairway's edge; never green, sand, water or a deck. */
export function grassAllowed(w: SurfaceWeights): boolean {
  return w.green > 0.99 && w.sand === 0 && w.water === 0 && w.bridge === 0 && w.corridor > 0.3;
}

export class GrassCarpet {
  readonly mesh: THREE.InstancedMesh;
  /** Tufts a cell can hold at this preset. */
  readonly bladeClumps: number;
  /** Cells scattered so far, for the tests and the dev readout. */
  rebuilds = 0;

  private readonly perCell: number;
  /** Cell key -> slot, for the cells in reach. */
  private readonly slotOf = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  private readonly time = { value: 0 };
  private readonly centre = { value: new THREE.Vector2() };
  private readonly weights = createSurfaceWeights();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private windowX = Number.NaN;
  private windowZ = Number.NaN;

  constructor(
    private readonly surfaces: Surfaces,
    private readonly heightAt: (x: number, z: number) => number,
    quality: QualityPreset,
  ) {
    this.perCell = Math.round(GRASS_CELL_M * GRASS_CELL_M * CLUMPS_PER_M2 * quality.grassDensity);
    this.bladeClumps = this.perCell * SIDE * SIDE;
    for (let i = SIDE * SIDE - 1; i >= 0; i--) this.freeSlots.push(i);

    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrassTime = this.time;
      shader.uniforms.uGrassCentre = this.centre;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uGrassTime;\nuniform vec2 uGrassCentre;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           {
             vec2 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
             float fade = 1.0 - smoothstep(${(GRASS_REACH_M * 0.7).toFixed(1)}, ${GRASS_REACH_M.toFixed(1)}, distance(root, uGrassCentre));
             float sway = sin(uGrassTime * 1.7 + root.x * 0.35 + root.y * 0.21) + 0.5 * sin(uGrassTime * 2.9 + root.x * 0.9);
             transformed.x += sway * 0.09 * position.y / ${BLADE_HEIGHT_M.toFixed(2)};
             transformed *= fade;
           }`,
        );
    };
    material.customProgramCacheKey = () => "grass-carpet";
    this.mesh = new THREE.InstancedMesh(buildClump(), material, this.bladeClumps);
    this.mesh.name = "grass-carpet";
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.bladeClumps; i++) this.mesh.setMatrixAt(i, this.zero);
  }

  get cellCount(): number {
    return this.slotOf.size;
  }

  /** Follows the camera at (x, z). Allocation-free unless a cell is re-scattered. */
  update(x: number, z: number, elapsedSeconds: number): void {
    this.time.value = elapsedSeconds;
    this.centre.value.set(x, z);
    const wx = Math.floor(x / GRASS_CELL_M) - SIDE / 2;
    const wz = Math.floor(z / GRASS_CELL_M) - SIDE / 2;
    if (wx === this.windowX && wz === this.windowZ) return;
    this.windowX = wx;
    this.windowZ = wz;

    // Hand back the slots of cells now out of reach...
    for (const [key, slot] of this.slotOf) {
      const cx = Math.floor(key / 4096) - 2048;
      const cz = (key % 4096) - 2048;
      if (cx < wx || cx >= wx + SIDE || cz < wz || cz >= wz + SIDE) {
        this.slotOf.delete(key);
        this.freeSlots.push(slot);
      }
    }
    // ...and give them to the cells that came into it.
    for (let cz = wz; cz < wz + SIDE; cz++) {
      for (let cx = wx; cx < wx + SIDE; cx++) {
        const key = (cx + 2048) * 4096 + (cz + 2048);
        if (this.slotOf.has(key)) continue;
        const slot = this.freeSlots.pop()!;
        this.slotOf.set(key, slot);
        this.scatter(cx, cz, slot);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }

  private scatter(cx: number, cz: number, slot: number): void {
    this.rebuilds++;
    const random = mulberry32(hashChannel(((cx * 73856093) ^ (cz * 19349663)) >>> 0, GRASS_CHANNEL));
    const base = slot * this.perCell;
    for (let i = 0; i < this.perCell; i++) {
      const x = (cx + random()) * GRASS_CELL_M;
      const z = (cz + random()) * GRASS_CELL_M;
      const yaw = random() * Math.PI * 2;
      const size = 0.7 + random() * 0.6;
      this.surfaces.weightsAt(x, z, this.weights);
      if (!grassAllowed(this.weights)) {
        this.mesh.setMatrixAt(base + i, this.zero);
        continue;
      }
      this.position.set(x, this.heightAt(x, z), z);
      this.rotation.setFromAxisAngle(this.up, yaw);
      this.scale.set(size, size, size);
      this.mesh.setMatrixAt(base + i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
  }
}

/** A tuft: blades fanned round its root, darker at the base than the tip. */
function buildClump(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const base = new THREE.Color(0x3f5f2c);
  const tip = new THREE.Color(0x9bb561);
  for (let b = 0; b < BLADES_PER_CLUMP; b++) {
    const angle = (b / BLADES_PER_CLUMP) * Math.PI * 2 + b * 0.7;
    const lean = 0.08 + 0.05 * (b % 3);
    const ox = Math.cos(angle) * 0.06;
    const oz = Math.sin(angle) * 0.06;
    const px = -Math.sin(angle) * BLADE_WIDTH_M * 0.5;
    const pz = Math.cos(angle) * BLADE_WIDTH_M * 0.5;
    const h = BLADE_HEIGHT_M * (0.75 + 0.1 * (b % 4));
    positions.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + Math.cos(angle) * lean, h, oz + Math.sin(angle) * lean);
    colours.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}
