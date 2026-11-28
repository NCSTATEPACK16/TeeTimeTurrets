import * as THREE from "three";
import { PATH_HALF_WIDTH_M } from "../sim/cartPaths";
import type { CartPath } from "../sim/cartPaths";

/**
 * The cart paths drawn (Stage 5 spec, §3.3): one ribbon along every polyline, sampled every
 * `SAMPLE_M`, each vertex sitting on the ground it covers plus `LIFT_M`, with a polygon offset so
 * the ground never shows through. Four columns across, so the concrete has a darker kerb at each
 * edge. One mesh, one draw.
 *
 * The course's, built once by `courseDressing.ts` and kept for the page like the woods.
 * Decorative: the sim's paths are the ones painted into the grids, from the same polylines.
 */

const SAMPLE_M = 2;
const LIFT_M = 0.04;
/** Where the kerb gives way to the slab, as a share of the half width. */
const KERB_SHARE = 0.85;
const CONCRETE = new THREE.Color(0xcfc8b4);
const KERB = new THREE.Color(0x9c9584);
/** Across the strip: offsets as shares of the half width, and the colour at each. */
const COLUMNS: readonly (readonly [number, THREE.Color])[] = [
  [-1, KERB],
  [-KERB_SHARE, CONCRETE],
  [KERB_SHARE, CONCRETE],
  [1, KERB],
];

/** Points every `SAMPLE_M` along one polyline, ends included, as x, z pairs. */
export function resamplePath(points: Float32Array, step = SAMPLE_M): number[] {
  const out: number[] = [];
  if (points.length < 4) return out;
  out.push(points[0]!, points[1]!);
  let carry = 0;
  for (let k = 0; k + 3 < points.length; k += 2) {
    const ax = points[k]!;
    const az = points[k + 1]!;
    const dx = points[k + 2]! - ax;
    const dz = points[k + 3]! - az;
    const len = Math.hypot(dx, dz);
    let s = step - carry;
    while (s < len) {
      out.push(ax + (dx * s) / len, az + (dz * s) / len);
      s += step;
    }
    carry = len - (s - step);
  }
  const lx = points[points.length - 2]!;
  const lz = points[points.length - 1]!;
  if (out[out.length - 2] !== lx || out[out.length - 1] !== lz) out.push(lx, lz);
  return out;
}

export interface CartPathStrip {
  readonly mesh: THREE.Mesh;
  readonly triangles: number;
  dispose(): void;
}

export function createCartPathStrip(
  paths: readonly CartPath[],
  heightAt: (x: number, z: number) => number,
): CartPathStrip | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const cols = COLUMNS.length;
  for (const path of paths) {
    const pts = resamplePath(path.points);
    const n = pts.length / 2;
    if (n < 2) continue;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      // The tangent from the neighbours either side, so a bend's two sides meet.
      const p = Math.max(0, i - 1);
      const q = Math.min(n - 1, i + 1);
      let tx = pts[q * 2]! - pts[p * 2]!;
      let tz = pts[q * 2 + 1]! - pts[p * 2 + 1]!;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const x = pts[i * 2]!;
      const z = pts[i * 2 + 1]!;
      for (const [share, colour] of COLUMNS) {
        const vx = x - tz * share * PATH_HALF_WIDTH_M;
        const vz = z + tx * share * PATH_HALF_WIDTH_M;
        positions.push(vx, heightAt(vx, vz) + LIFT_M, vz);
        colours.push(colour.r, colour.g, colour.b);
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      for (let c = 0; c + 1 < cols; c++) {
        const a = base + i * cols + c;
        const b = a + cols;
        // Across (a to a + 1) is the tangent turned left, so across x along is up: counter-clockwise
        // seen from above, whichever way the path runs.
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "cart-paths";
  return {
    mesh,
    triangles: indices.length / 3,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
