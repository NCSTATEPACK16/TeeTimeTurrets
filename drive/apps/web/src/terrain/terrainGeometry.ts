import { colToX, rowToZ, type GridInfo } from '@gcs/level-schema';

export interface ChunkArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Linear-space RGB per material ID, 0..1. */
export type Palette = readonly (readonly [number, number, number])[];

/** Node indices from `start` to `start + count` every `stride`, always including the last one. */
export function strideSamples(start: number, count: number, stride: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k += stride) out.push(start + k);
  out.push(start + count);
  return out;
}

/**
 * Builds the render mesh for the cell block [c0, c0 + cols) x [r0, r0 + rows).
 * At stride 1, triangles use the same diagonal as the Rapier collider and HeightSampler, so the
 * visible surface is exactly the surface the wheels ride on:
 *   lower (r, c), (r+1, c), (r, c+1)   upper (r, c+1), (r+1, c), (r+1, c+1)
 * Winding is counter-clockwise seen from above. Coarser strides (distance LOD) sample every
 * `stride` nodes and keep the block's border nodes, so neighbors share their corners.
 * `skirtDepth` > 0 hangs a vertical strip that deep below every border edge (both windings),
 * hiding cracks where chunks of different strides meet.
 */
export function buildTerrainChunk(
  grid: GridInfo,
  heights: Float64Array,
  material: Uint8Array,
  palette: Palette,
  c0: number,
  r0: number,
  cols: number,
  rows: number,
  stride = 1,
  skirtDepth = 0,
): ChunkArrays {
  const { width, height, cellSize } = grid;
  const cs = strideSamples(c0, cols, stride);
  const rs = strideSamples(r0, rows, stride);
  const vw = cs.length;
  const vh = rs.length;
  const border = skirtDepth > 0 ? 2 * (vw + vh) - 4 : 0;
  const vcount = vw * vh + border;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  const h = (r: number, c: number) =>
    heights[Math.min(Math.max(r, 0), height - 1) * width + Math.min(Math.max(c, 0), width - 1)]!;

  const put = (v: number, r: number, c: number, drop: number) => {
    const k = v * 3;
    positions[k] = colToX(grid, c);
    positions[k + 1] = h(r, c) - drop;
    positions[k + 2] = rowToZ(grid, r);
    // Smooth shading normal from central differences (visual only).
    const dx = (h(r, c + 1) - h(r, c - 1)) / (2 * cellSize);
    const dz = (h(r + 1, c) - h(r - 1, c)) / (2 * cellSize);
    const len = Math.hypot(dx, 1, dz);
    normals[k] = -dx / len;
    normals[k + 1] = 1 / len;
    normals[k + 2] = -dz / len;
    const rgb = palette[material[r * width + c]!] ?? palette[0]!;
    colors[k] = rgb[0];
    colors[k + 1] = rgb[1];
    colors[k + 2] = rgb[2];
  };
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) put(j * vw + i, rs[j]!, cs[i]!, 0);

  const quads = (vw - 1) * (vh - 1);
  const indices = new Uint32Array(quads * 6 + border * 12);
  let n = 0;
  for (let j = 0; j < vh - 1; j++) {
    for (let i = 0; i < vw - 1; i++) {
      const a = j * vw + i; // (r, c)
      const b = a + 1; // (r, c+1)
      const d = a + vw; // (r+1, c)
      const e = d + 1; // (r+1, c+1)
      indices[n++] = a;
      indices[n++] = d;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = d;
      indices[n++] = e;
    }
  }

  if (skirtDepth > 0) {
    // Border ring, clockwise from the north-west corner, as top-vertex indices.
    const ring: number[] = [];
    for (let i = 0; i < vw - 1; i++) ring.push(i);
    for (let j = 0; j < vh - 1; j++) ring.push(j * vw + vw - 1);
    for (let i = vw - 1; i > 0; i--) ring.push((vh - 1) * vw + i);
    for (let j = vh - 1; j > 0; j--) ring.push(j * vw);
    const base = vw * vh;
    ring.forEach((top, k) => put(base + k, rs[Math.floor(top / vw)]!, cs[top % vw]!, skirtDepth));
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % ring.length]!;
      const a2 = base + k;
      const b2 = base + ((k + 1) % ring.length);
      for (const [p, q, r] of [
        [a, a2, b],
        [b, a2, b2],
        [a, b, a2],
        [b, b2, a2],
      ] as const) {
        indices[n++] = p;
        indices[n++] = q;
        indices[n++] = r;
      }
    }
  }
  return { positions, normals, colors, indices };
}

/** Splits the grid's cells into square chunks; returns [c0, r0, cols, rows] per chunk. */
export function chunkLayout(grid: GridInfo, chunkCells: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const cellsX = grid.width - 1;
  const cellsZ = grid.height - 1;
  for (let r0 = 0; r0 < cellsZ; r0 += chunkCells) {
    for (let c0 = 0; c0 < cellsX; c0 += chunkCells) {
      out.push([c0, r0, Math.min(chunkCells, cellsX - c0), Math.min(chunkCells, cellsZ - r0)]);
    }
  }
  return out;
}

/** '#rrggbb' (sRGB) to linear RGB. */
export function hexToLinear(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
}
