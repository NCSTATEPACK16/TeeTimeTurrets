import { xToCol, zToRow, type GridInfo } from '@gcs/level-schema';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * CPU height lookup that matches the Rapier heightfield exactly.
 *
 * Each cell is split along the diagonal from node (row, col+1) to node (row+1, col), as
 * Rapier triangulates heightfields (verified by test/physics/heightfieldLayout.test.ts).
 * With u, v the fractional column and row inside a cell, u + v <= 1 is the triangle that
 * holds node (row, col).
 */
export class HeightSampler {
  constructor(
    readonly grid: GridInfo,
    readonly heights: Float64Array,
  ) {
    if (heights.length !== grid.width * grid.height) throw new Error('height grid size mismatch');
  }

  /** Height of node (row, col). */
  node(row: number, col: number): number {
    return this.heights[row * this.grid.width + col]!;
  }

  /** Terrain height at world (x, z); positions outside the grid clamp to its edge. */
  heightAt(x: number, z: number): number {
    const { width, height } = this.grid;
    const col = clamp(xToCol(this.grid, x), 0, width - 1);
    const row = clamp(zToRow(this.grid, z), 0, height - 1);
    const c0 = Math.min(Math.floor(col), width - 2);
    const r0 = Math.min(Math.floor(row), height - 2);
    const u = col - c0;
    const v = row - r0;
    const h00 = this.node(r0, c0);
    const h01 = this.node(r0, c0 + 1);
    const h10 = this.node(r0 + 1, c0);
    if (u + v <= 1) return h00 + u * (h01 - h00) + v * (h10 - h00);
    const h11 = this.node(r0 + 1, c0 + 1);
    return h11 + (1 - u) * (h10 - h11) + (1 - v) * (h01 - h11);
  }

  /** Unit surface normal of the triangle under world (x, z). */
  normalAt(x: number, z: number, out: Vec3Like = { x: 0, y: 1, z: 0 }): Vec3Like {
    const { width, height, cellSize } = this.grid;
    const col = clamp(xToCol(this.grid, x), 0, width - 1);
    const row = clamp(zToRow(this.grid, z), 0, height - 1);
    const c0 = Math.min(Math.floor(col), width - 2);
    const r0 = Math.min(Math.floor(row), height - 2);
    const u = col - c0;
    const v = row - r0;
    let dhdx: number;
    let dhdz: number;
    if (u + v <= 1) {
      const h00 = this.node(r0, c0);
      dhdx = this.node(r0, c0 + 1) - h00;
      dhdz = this.node(r0 + 1, c0) - h00;
    } else {
      const h11 = this.node(r0 + 1, c0 + 1);
      dhdx = h11 - this.node(r0 + 1, c0);
      dhdz = h11 - this.node(r0, c0 + 1);
    }
    dhdx /= cellSize;
    dhdz /= cellSize;
    const len = Math.hypot(dhdx, 1, dhdz);
    out.x = -dhdx / len;
    out.y = 1 / len;
    out.z = -dhdz / len;
    return out;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
