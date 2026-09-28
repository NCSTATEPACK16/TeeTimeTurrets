import * as THREE from "three";
import { PATH_HALF_WIDTH_M } from "../sim/cartPaths";
import type { CartPath } from "../sim/cartPaths";

/**
 * The cart paths drawn: a strip of pale gravel draped over the ground along each path, exactly as
 * wide as the band `pathWeightAt` gives full speed on. One mesh for the course.
 */

/** Metres between cross-sections along a path, so the strip follows the ground's rises. */
const STEP_M = 3;
/** Height above the ground, with a polygon offset, so it never fights the turf. */
const LIFT_M = 0.04;

export interface CartPathRibbons {
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

export function createCartPathRibbons(
  paths: readonly CartPath[],
  heightAt: (x: number, z: number) => number,
): CartPathRibbons {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const path of paths) {
    for (let s = 0; s + 1 < path.points.length; s++) {
      const a = path.points[s]!;
      const b = path.points[s + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len === 0) continue;
      const nx = (-(b.z - a.z) / len) * PATH_HALF_WIDTH_M;
      const nz = ((b.x - a.x) / len) * PATH_HALF_WIDTH_M;
      const steps = Math.max(1, Math.ceil(len / STEP_M));
      const base = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        positions.push(x + nx, heightAt(x + nx, z + nz) + LIFT_M, z + nz);
        positions.push(x - nx, heightAt(x - nx, z - nz) + LIFT_M, z - nz);
        if (i < steps) {
          const k = base + i * 2;
          indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb9ad90,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "cart-paths";
  mesh.receiveShadow = true;
  return {
    mesh,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
