import { toCourseFrame } from "../sim/courseGeometry";
import type { PlacedHole } from "../sim/courseTerrain";
import { polygonSignedDistance } from "../sim/hazards";

/**
 * The water surface's geometry, without three: one flat sheet per pond at the hole's water level,
 * with the depth of water over the ground baked at every vertex.
 *
 * The depth is what lets the shader draw a shore without a depth texture. Where the sheet meets the
 * bank the baked depth runs to 0, so a band of foam and a shallow colour sit exactly on the line
 * where the ground comes up through the water -- on every preset, including the ones with no post
 * chain to read a depth buffer from.
 *
 * Pure and node-testable: `water.ts` wraps the arrays in a `BufferGeometry`.
 */

/** Grid spacing of the sheet, metres. Fine enough that the baked depth follows a 6 m beach. */
export const WATER_CELL_M = 2;

/**
 * How far past the placed polygon the sheet may reach, metres. The basin is carved inside the
 * polygon, but the course blend can leave the bank just under the water level for a metre or two
 * outside it; stopping exactly at the polygon would show a dry ledge there.
 */
const POLYGON_MARGIN_M = 3;

/** The depth given to a vertex the sim does not call water: just dry, so the sheet ends there. */
export const NOT_WATER_DEPTH_M = -0.05;

/** Cells per side of a merged deep-water block. */
const BLOCK = 4;
/** Depth past which a block of cells is merged: the colour ramp has saturated by here. */
const DEEP_BLOCK_DEPTH_M = 1.05;

export interface WaterMesh {
  /** xyz per vertex, course frame. */
  readonly positions: Float32Array;
  /** Water depth over the ground at each vertex, metres. Negative where the bank is above it. */
  readonly depth: Float32Array;
  /** rgb per vertex, 0..1: the pond's biome water colour, still sRGB (the shader linearises it). */
  readonly colour: Float32Array;
  readonly indices: Uint32Array;
  /** Ponds that produced at least one cell. */
  readonly ponds: number;
}

/**
 * Builds every pond on the course into one sheet, so all the water is one draw.
 *
 * `colourOf` maps a hole to its water colour (the biome palette lives in `src/render/biomes.ts`;
 * taking it as a function keeps this module free of the palette's own imports).
 */
export function buildWaterMesh(
  holes: readonly PlacedHole[],
  heightAt: (x: number, z: number) => number,
  isWater: (x: number, z: number) => boolean,
  colourOf: (hole: PlacedHole) => number,
): WaterMesh {
  const positions: number[] = [];
  const depth: number[] = [];
  const colour: number[] = [];
  const indices: number[] = [];
  const world = { x: 0, z: 0 };
  let ponds = 0;

  for (const hole of holes) {
    const level = hole.spec.waterLevel;
    const hex = colourOf(hole);
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;

    for (const pond of hole.spec.water) {
      // The grid is laid in the hole's own frame, where the polygon is, and each vertex is moved
      // into the course frame afterwards. Laying it in the course frame would need the polygon
      // rotated first and gain nothing.
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const p of pond.points) {
        minX = Math.min(minX, p.x);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxZ = Math.max(maxZ, p.z);
      }
      minX -= POLYGON_MARGIN_M;
      minZ -= POLYGON_MARGIN_M;
      maxX += POLYGON_MARGIN_M;
      maxZ += POLYGON_MARGIN_M;
      const cols = Math.max(1, Math.ceil((maxX - minX) / WATER_CELL_M));
      const rows = Math.max(1, Math.ceil((maxZ - minZ) / WATER_CELL_M));
      const side = cols + 1;

      // Every grid vertex, in case a cell keeps it; only the kept ones are emitted.
      const vx = new Float32Array(side * (rows + 1));
      const vz = new Float32Array(side * (rows + 1));
      const vd = new Float32Array(side * (rows + 1));
      const inside = new Uint8Array(side * (rows + 1));
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const k = j * side + i;
          const lx = minX + (i / cols) * (maxX - minX);
          const lz = minZ + (j / rows) * (maxZ - minZ);
          toCourseFrame(hole.placement, lx, lz, world);
          vx[k] = world.x;
          vz[k] = world.z;
          // What the sim calls water, not the polygon. They differ: where another hole's fairway
          // wins the course blend inside a pond polygon, the sim drives on fairway there, and the
          // ground can still sit below the water level (hole 18 has 0.3 m of it). Water drawn there
          // would be water a cart drives through dry. So a vertex that is not water is given a
          // depth just under 0, and the shader fades the sheet out with foam along that edge.
          const wet = polygonSignedDistance(lx, lz, pond) < POLYGON_MARGIN_M && isWater(world.x, world.z);
          inside[k] = wet ? 1 : 0;
          const d = level - heightAt(world.x, world.z);
          vd[k] = wet ? d : Math.min(d, NOT_WATER_DEPTH_M);
        }
      }

      const emitted = new Int32Array(side * (rows + 1)).fill(-1);
      const emit = (k: number): number => {
        if (emitted[k]! >= 0) return emitted[k]!;
        const index = positions.length / 3;
        positions.push(vx[k]!, level, vz[k]!);
        depth.push(vd[k]!);
        colour.push(r, g, b);
        emitted[k] = index;
        return index;
      };

      let cells = 0;
      // Deep water first, in blocks of BLOCK x BLOCK cells drawn as one quad. Past
      // `DEEP_BLOCK_DEPTH_M` the colour has saturated and there is no foam, so the fine grid there
      // only carried a depth nobody can see change. The sheet is flat, so the T-junctions where a
      // block meets fine cells leave no crack.
      const merged = new Uint8Array(cols * rows);
      for (let bj = 0; bj + BLOCK <= rows; bj += BLOCK) {
        for (let bi = 0; bi + BLOCK <= cols; bi += BLOCK) {
          let deep = true;
          for (let j = bj; j <= bj + BLOCK && deep; j++) {
            for (let i = bi; i <= bi + BLOCK && deep; i++) {
              const k = j * side + i;
              if (!inside[k] || vd[k]! < DEEP_BLOCK_DEPTH_M) deep = false;
            }
          }
          if (!deep) continue;
          const a = bj * side + bi;
          const ia = emit(a);
          const ib = emit(a + BLOCK);
          const ic = emit(a + BLOCK * side);
          const id = emit(a + BLOCK * side + BLOCK);
          indices.push(ia, ic, ib, ib, ic, id);
          cells++;
          for (let j = bj; j < bj + BLOCK; j++) for (let i = bi; i < bi + BLOCK; i++) merged[j * cols + i] = 1;
        }
      }
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (merged[j * cols + i]) continue;
          const a = j * side + i;
          const bq = a + 1;
          const c = a + side;
          const d = c + 1;
          if (!inside[a] && !inside[bq] && !inside[c] && !inside[d]) continue;
          const ia = emit(a);
          const ib = emit(bq);
          const ic = emit(c);
          const id = emit(d);
          // Wound so the face points up (+Y) in the course frame. A hole placed with a reflection
          // would flip it, but placements are rotations only.
          indices.push(ia, ic, ib, ib, ic, id);
          cells++;
        }
      }
      if (cells > 0) ponds++;
    }
  }

  return {
    positions: new Float32Array(positions),
    depth: new Float32Array(depth),
    colour: new Float32Array(colour),
    indices: new Uint32Array(indices),
    ponds,
  };
}

/** Ripple slots the shader holds: the last eight splashes. */
export const RIPPLE_SLOTS = 8;
/** How long a ripple runs before its slot is free again, seconds. */
export const RIPPLE_LIFE_S = 2.6;

/**
 * The ripple ring buffer the shader reads: `x, z, start time, 1` per slot, with start time far in
 * the past for an empty slot. Kept apart from three so the reuse rule is testable.
 */
export class RippleRing {
  /** Four floats per slot, the layout of the shader's `vec4` array. */
  readonly data = new Float32Array(RIPPLE_SLOTS * 4);
  private next = 0;

  constructor() {
    for (let i = 0; i < RIPPLE_SLOTS; i++) this.data[i * 4 + 2] = -1e4;
  }

  /** A splash at `x, z` at time `now`. Overwrites the oldest slot. Never allocates. */
  push(x: number, z: number, now: number): void {
    const o = this.next * 4;
    this.data[o] = x;
    this.data[o + 1] = z;
    this.data[o + 2] = now;
    this.data[o + 3] = 1;
    this.next = (this.next + 1) % RIPPLE_SLOTS;
  }

  /** Slots still running at `now`. For tests. */
  live(now: number): number {
    let n = 0;
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const age = now - this.data[i * 4 + 2]!;
      if (age >= 0 && age < RIPPLE_LIFE_S) n++;
    }
    return n;
  }
}
