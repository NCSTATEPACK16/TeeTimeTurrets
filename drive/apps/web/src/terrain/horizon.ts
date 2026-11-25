import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three/webgpu';
import type { GridInfo, HorizonInfo } from '@gcs/level-schema';
import { envConfig } from '../env/envConfig';
import type { Level } from '../level/loadLevel';
import { hexToLinear } from './terrainGeometry';

export interface HorizonArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Cells drawn (two triangles each). */
  cells: number;
}

/**
 * The horizon skirt: visual only, no collider. Cells that lie entirely inside the course
 * rectangle, shrunk by one skirt cell, are dropped; the pipeline sinks the skirt under the
 * course there, so the thin overlap ring hides the seam without z-fighting.
 */
export function buildHorizonArrays(
  info: HorizonInfo,
  heights: Float32Array,
  course: GridInfo,
  rgb: readonly [number, number, number],
  stride = 1,
): HorizonArrays {
  const { width: w, height: h, cellSize: cs, originX, originZ } = info;
  const positions = new Float32Array(w * h * 3);
  const normals = new Float32Array(w * h * 3);
  const colors = new Float32Array(w * h * 3);
  const at = (r: number, c: number) => heights[Math.min(Math.max(r, 0), h - 1) * w + Math.min(Math.max(c, 0), w - 1)]!;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const k = (r * w + c) * 3;
      positions[k] = originX + c * cs;
      positions[k + 1] = at(r, c);
      positions[k + 2] = originZ + r * cs;
      const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * cs);
      const dz = (at(r + 1, c) - at(r - 1, c)) / (2 * cs);
      const len = Math.hypot(dx, 1, dz);
      normals[k] = -dx / len;
      normals[k + 1] = 1 / len;
      normals[k + 2] = -dz / len;
      colors[k] = rgb[0];
      colors[k + 1] = rgb[1];
      colors[k + 2] = rgb[2];
    }
  }
  // Draw every `stride` nodes: the skirt is distant, visual-only ground.
  const st = Math.max(1, Math.floor(stride));
  const hx = ((course.width - 1) / 2) * course.cellSize - cs * st;
  const hz = ((course.height - 1) / 2) * course.cellSize - cs * st;
  const idx: number[] = [];
  for (let r = 0; r + st <= h - 1; r += st) {
    const z0 = originZ + r * cs;
    for (let c = 0; c + st <= w - 1; c += st) {
      const x0 = originX + c * cs;
      const inside = x0 >= -hx && x0 + cs * st <= hx && z0 >= -hz && z0 + cs * st <= hz;
      if (inside) continue;
      const a = r * w + c;
      const b = a + st;
      const d = a + w * st;
      const e = d + st;
      idx.push(a, d, b, b, d, e);
    }
  }
  return { positions, normals, colors, indices: Uint32Array.from(idx), cells: idx.length / 6 };
}

export function createHorizonMesh(level: Level, material: Material): Mesh | null {
  if (!level.horizon) return null;
  const a = buildHorizonArrays(
    level.horizon.info,
    level.horizon.heights,
    level.grid,
    hexToLinear(envConfig.horizon.color),
    envConfig.horizon.stride,
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(a.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(a.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(a.colors, 3));
  geometry.setIndex(new BufferAttribute(a.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'horizon';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
