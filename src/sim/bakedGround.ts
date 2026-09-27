import type { Bounds } from "./courseLayout";
import { SurfaceId, createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, SurfaceWeights, Surfaces } from "./surfaces";

/**
 * The course's ground, baked to grids for the queries that run every tick and every frame.
 *
 * The blended eighteen-hole course answers `heightAt`, `surfaceAt` and `tuningAt` exactly, at about
 * 9-11 us each: every query walks the holes' influence, transforms into each hole's frame and
 * blends. That is fine for building a heightfield once and ruinous for a nameplate's line of sight,
 * which asked it thousands of times a frame. Measured, and why this exists (`docs/REVAMP-PLAN.md`
 * Stage 3).
 *
 * - **Heights** are the heightfield Rapier already collides with, read by bilinear interpolation.
 *   The collider and the queries now agree on the one set of samples.
 * - **Surfaces and tuning** are sampled at the same nodes, lazily, a tile at a time, the first time
 *   anything asks about that tile. Baking all half-million nodes up front costs about ten seconds;
 *   a match touches a few dozen tiles. A node's value is a pure function of where it is, so the
 *   answers are the same whatever order tiles are baked in, and the sim stays deterministic.
 *
 * Classification is the nearest node's; continuous tuning is interpolated, as the exact version
 * blends. DOM-free, and every query is allocation-free.
 */

/** A height grid in Rapier's layout: `heights[row + col * (rows + 1)]`, row along Z, column along X. */
export interface HeightGrid {
  readonly minX: number;
  readonly minZ: number;
  /** Metres between columns, and between rows. Close to the cell size, not always exactly it. */
  readonly dx: number;
  readonly dz: number;
  readonly cols: number;
  readonly rows: number;
  readonly heights: Float32Array;
}

/** Cells on each axis for `bounds` at `cellM`, as `courseTerrain.ts` counts them. */
function cellCounts(bounds: Bounds, cellM: number): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellM)),
    rows: Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / cellM)),
  };
}

/** Samples `heightAt` at every node of the grid over `bounds`. */
export function bakeHeightGrid(bounds: Bounds, cellM: number, heightAt: (x: number, z: number) => number): HeightGrid {
  const { cols, rows } = cellCounts(bounds, cellM);
  const extentX = bounds.maxX - bounds.minX;
  const extentZ = bounds.maxZ - bounds.minZ;
  const heights = new Float32Array((rows + 1) * (cols + 1));
  for (let col = 0; col <= cols; col++) {
    const x = bounds.minX + (col / cols) * extentX;
    for (let row = 0; row <= rows; row++) {
      heights[row + col * (rows + 1)] = heightAt(x, bounds.minZ + (row / rows) * extentZ);
    }
  }
  return { minX: bounds.minX, minZ: bounds.minZ, dx: extentX / cols, dz: extentZ / rows, cols, rows, heights };
}

/** A grid built from heights already sampled -- the heightfield Rapier was handed. */
export function heightGridFrom(bounds: Bounds, cols: number, rows: number, heights: Float32Array): HeightGrid {
  return {
    minX: bounds.minX,
    minZ: bounds.minZ,
    dx: (bounds.maxX - bounds.minX) / cols,
    dz: (bounds.maxZ - bounds.minZ) / rows,
    cols,
    rows,
    heights,
  };
}

/** Bilinear height at (x, z); past the box, the edge's. */
export function gridHeightAt(grid: HeightGrid, x: number, z: number): number {
  const fx = clamp((x - grid.minX) / grid.dx, 0, grid.cols);
  const fz = clamp((z - grid.minZ) / grid.dz, 0, grid.rows);
  const c0 = Math.min(Math.floor(fx), grid.cols - 1);
  const r0 = Math.min(Math.floor(fz), grid.rows - 1);
  const tx = fx - c0;
  const tz = fz - r0;
  const stride = grid.rows + 1;
  const h = grid.heights;
  const h00 = h[r0 + c0 * stride]!;
  const h01 = h[r0 + 1 + c0 * stride]!;
  const h10 = h[r0 + (c0 + 1) * stride]!;
  const h11 = h[r0 + 1 + (c0 + 1) * stride]!;
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/** Surface ids by index: a node stores its surface as an index into this. */
const SURFACE_IDS: readonly SurfaceId[] = Object.values(SurfaceId);
const WATER_INDEX = SURFACE_IDS.indexOf(SurfaceId.Water);

/** Nodes per tile side. 32 nodes at 2 m is a 64 m tile: a few per cart, baked in about 20 ms. */
const DEFAULT_TILE_NODES = 32;

export class BakedSurfaces implements Surfaces {
  /** Tiles baked so far. For tests and for the dev readout. */
  tilesBaked = 0;
  private readonly source: Surfaces;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly dx: number;
  private readonly dz: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly tileNodes: number;
  private readonly tilesX: number;
  private readonly tileBaked: Uint8Array;
  private readonly surface: Uint8Array;
  private readonly hazard: Uint8Array;
  // Float64, not Float32: the exact values at a node, so a tuning read at a node is the source's.
  private readonly rolling: Float64Array;
  private readonly bounce: Float64Array;
  private readonly speed: Float64Array;
  private readonly tuningScratch = createSurfaceTuning();

  constructor(source: Surfaces, bounds: Bounds, cellM: number, tileNodes: number = DEFAULT_TILE_NODES) {
    const { cols, rows } = cellCounts(bounds, cellM);
    this.source = source;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.dx = (bounds.maxX - bounds.minX) / cols;
    this.dz = (bounds.maxZ - bounds.minZ) / rows;
    this.cols = cols;
    this.rows = rows;
    this.tileNodes = tileNodes;
    this.tilesX = Math.ceil((cols + 1) / tileNodes);
    const tilesZ = Math.ceil((rows + 1) / tileNodes);
    this.tileBaked = new Uint8Array(this.tilesX * tilesZ);
    const nodes = (cols + 1) * (rows + 1);
    this.surface = new Uint8Array(nodes);
    this.hazard = new Uint8Array(nodes);
    this.rolling = new Float64Array(nodes);
    this.bounce = new Float64Array(nodes);
    this.speed = new Float64Array(nodes);
  }

  surfaceAt(x: number, z: number): SurfaceId {
    return SURFACE_IDS[this.surface[this.nearestNode(x, z)]!]!;
  }

  tuningAt(x: number, z: number, out: MutableSurfaceTuning): void {
    const fx = clamp((x - this.minX) / this.dx, 0, this.cols);
    const fz = clamp((z - this.minZ) / this.dz, 0, this.rows);
    const c0 = Math.min(Math.floor(fx), this.cols - 1);
    const r0 = Math.min(Math.floor(fz), this.rows - 1);
    const tx = fx - c0;
    const tz = fz - r0;
    const n00 = this.node(c0, r0);
    const n01 = this.node(c0, r0 + 1);
    const n10 = this.node(c0 + 1, r0);
    const n11 = this.node(c0 + 1, r0 + 1);
    const w00 = (1 - tx) * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w10 = tx * (1 - tz);
    const w11 = tx * tz;
    out.rolling = this.rolling[n00]! * w00 + this.rolling[n01]! * w01 + this.rolling[n10]! * w10 + this.rolling[n11]! * w11;
    out.bounceScale = this.bounce[n00]! * w00 + this.bounce[n01]! * w01 + this.bounce[n10]! * w10 + this.bounce[n11]! * w11;
    out.cartSpeedScale = this.speed[n00]! * w00 + this.speed[n01]! * w01 + this.speed[n10]! * w10 + this.speed[n11]! * w11;
    out.isHazard = this.hazard[this.nearestNode(x, z)] === 1;
  }

  /** Not baked: the renderer's once-per-texel pass, never a per-tick query. */
  weightsAt(x: number, z: number, out: SurfaceWeights): void {
    this.source.weightsAt(x, z, out);
  }

  /** The index of node (col, row), its tile baked first. */
  private node(col: number, row: number): number {
    const t = Math.floor(col / this.tileNodes) + Math.floor(row / this.tileNodes) * this.tilesX;
    if (this.tileBaked[t] === 0) this.bakeTile(t);
    return row + col * (this.rows + 1);
  }

  private nearestNode(x: number, z: number): number {
    const col = Math.round(clamp((x - this.minX) / this.dx, 0, this.cols));
    const row = Math.round(clamp((z - this.minZ) / this.dz, 0, this.rows));
    return this.node(col, row);
  }

  private bakeTile(t: number): void {
    this.tileBaked[t] = 1;
    this.tilesBaked++;
    const tx = t % this.tilesX;
    const tz = Math.floor(t / this.tilesX);
    const colEnd = Math.min(this.cols, (tx + 1) * this.tileNodes - 1);
    const rowEnd = Math.min(this.rows, (tz + 1) * this.tileNodes - 1);
    const tuning = this.tuningScratch;
    for (let col = tx * this.tileNodes; col <= colEnd; col++) {
      const x = this.minX + col * this.dx;
      for (let row = tz * this.tileNodes; row <= rowEnd; row++) {
        const z = this.minZ + row * this.dz;
        const i = row + col * (this.rows + 1);
        this.surface[i] = SURFACE_IDS.indexOf(this.source.surfaceAt(x, z));
        this.source.tuningAt(x, z, tuning);
        this.rolling[i] = tuning.rolling;
        this.bounce[i] = tuning.bounceScale;
        this.speed[i] = tuning.cartSpeedScale;
        this.hazard[i] = tuning.isHazard || this.surface[i] === WATER_INDEX ? 1 : 0;
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
