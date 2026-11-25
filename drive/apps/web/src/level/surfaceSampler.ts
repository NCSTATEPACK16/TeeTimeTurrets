import { MATERIAL_NAMES, MaterialId, xToCol, zToRow, type GridInfo, type MaterialName } from '@gcs/level-schema';

/** Material lookup: the nearest grid node's material ID. Outside the grid reads as rough. */
export class SurfaceSampler {
  constructor(
    readonly grid: GridInfo,
    readonly material: Uint8Array,
  ) {
    if (material.length !== grid.width * grid.height) throw new Error('material grid size mismatch');
  }

  materialIdAt(x: number, z: number): number {
    const col = Math.floor(xToCol(this.grid, x) + 0.5);
    const row = Math.floor(zToRow(this.grid, z) + 0.5);
    if (col < 0 || row < 0 || col >= this.grid.width || row >= this.grid.height) return MaterialId.rough;
    return this.material[row * this.grid.width + col]!;
  }

  materialAt(x: number, z: number): MaterialName {
    return MATERIAL_NAMES[this.materialIdAt(x, z)] ?? 'rough';
  }
}
