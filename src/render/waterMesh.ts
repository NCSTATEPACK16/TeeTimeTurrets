import { toCourseFrame } from "../sim/courseGeometry";
import type { PlacedHole } from "../sim/courseTerrain";
import { polygonSignedDistance } from "../sim/hazards";

/**
 * The water surface's geometry, without three: one flat sheet per pond, at the height that pond's
 * basin can actually hold, with the depth of water over the ground baked at every vertex.
 *
 * **A pond's level is where its basin spills, not a number every pond shares.** Every hole is
 * authored with the same `waterLevel`, and the basin is carved down from it, but the course blends
 * heights across holes and the ground around a pond can sit metres below that shared level. A sheet
 * drawn there floats: its edge hangs above lower ground, because water that high would run out. So
 * each pond's level is `min(waterLevel, spill - freeboard)`, where `spill` is the lowest ground a
 * path out of the basin has to cross (a priority flood from the pond's deepest point), and the
 * water is only the ground connected to that deepest point and below the level. By construction
 * the sheet then ends where the ground comes up to meet it. The level is a drawing choice; the sim
 * uses `waterLevel` for the carving and never reads the height the water is drawn at.
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
 * How far past the placed polygon the grid reaches, metres. The basin's pour point has to be
 * inside it: it is where the priority flood leaves the window, so a window that stops short of the
 * rim would call a deeper outlet's level the spill.
 */
const WINDOW_MARGIN_M = 24;

/** How far under the spill level the water stands, metres, so it never reaches the rim itself. */
export const SPILL_FREEBOARD_M = 0.04;

/** Ground this far under the level, metres, counts as water. */
const WET_MIN_DEPTH_M = 0.02;

/** A pond whose basin holds less than this much water at its floor, metres, is not drawn. */
const MIN_BASIN_DEPTH_M = 0.08;

/** The depth given to a vertex that is not water: just dry, so the sheet ends there. */
export const NOT_WATER_DEPTH_M = -0.05;

/** Cells per side of a merged deep-water block. */
const BLOCK = 4;
/** Depth past which a block of cells is merged: the colour ramp has saturated by here. */
const DEEP_BLOCK_DEPTH_M = 1.05;

/** What was decided for one pond, for the tests and the PR's numbers. */
export interface WaterPondInfo {
  /** Index of the hole in the `holes` array. */
  readonly hole: number;
  /** The level every hole shares: where the basin was carved from. */
  readonly nominal: number;
  /** The lowest ground the water would spill over, metres. */
  readonly spill: number;
  /** The level the sheet is drawn at: `min(nominal, spill - freeboard)`. */
  readonly level: number;
  /** The deepest ground in the pond. */
  readonly floor: number;
  /** Grid vertices that are water. */
  readonly wet: number;
}

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
  /** One entry per pond drawn. */
  readonly info: readonly WaterPondInfo[];
  /**
   * The shoreline, as points where the sheet's depth crosses zero along a grid edge: `x, z` of
   * the crossing, the unit direction `dx, dz` from the water toward the bank, and the pond's drawn
   * level, five floats a point, about one every `WATER_CELL_M` along every shore. What bank-side
   * dressing is placed from (`cattails.ts`).
   */
  readonly shore: Float32Array;
}

/** Floats per shoreline point in `WaterMesh.shore`. */
export const SHORE_STRIDE = 5;

/**
 * The lowest ground a path out of the grid has to cross, starting at `seed`: a priority flood,
 * always extending the frontier at its lowest cell, so the first time it reaches the grid's edge
 * the highest ground it crossed on the way is the lowest of any route's highest point.
 */
export function spillLevel(ground: Float32Array, side: number, rows: number, seed: number): number {
  // A binary min-heap of [key, cell], keyed on the highest ground met on the way to the cell.
  const keys: number[] = [ground[seed]!];
  const cells: number[] = [seed];
  const best = new Float32Array(ground.length).fill(Infinity);
  best[seed] = ground[seed]!;
  const done = new Uint8Array(ground.length);
  const swap = (a: number, b: number): void => {
    [keys[a], keys[b]] = [keys[b]!, keys[a]!];
    [cells[a], cells[b]] = [cells[b]!, cells[a]!];
  };
  const push = (key: number, cell: number): void => {
    keys.push(key);
    cells.push(cell);
    let c = keys.length - 1;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (keys[parent]! <= keys[c]!) break;
      swap(parent, c);
      c = parent;
    }
  };
  while (keys.length > 0) {
    const key = keys[0]!;
    const cell = cells[0]!;
    const lastKey = keys.pop()!;
    const lastCell = cells.pop()!;
    if (keys.length > 0) {
      keys[0] = lastKey;
      cells[0] = lastCell;
      let c = 0;
      for (;;) {
        let m = c;
        const l = 2 * c + 1;
        const r = l + 1;
        if (l < keys.length && keys[l]! < keys[m]!) m = l;
        if (r < keys.length && keys[r]! < keys[m]!) m = r;
        if (m === c) break;
        swap(m, c);
        c = m;
      }
    }
    if (done[cell]) continue;
    done[cell] = 1;
    const i = cell % side;
    const j = (cell - i) / side;
    if (i === 0 || j === 0 || i === side - 1 || j === rows) return key;
    for (const next of [cell + 1, cell - 1, cell + side, cell - side]) {
      const nextKey = Math.max(key, ground[next]!);
      if (nextKey < best[next]!) {
        best[next] = nextKey;
        push(nextKey, next);
      }
    }
  }
  return Infinity;
}

/**
 * Builds every pond on the course into one sheet, so all the water is one draw.
 *
 * `colourOf` maps a hole to its water colour (the biome palette lives in `src/render/biomes.ts`;
 * taking it as a function keeps this module free of the palette's own imports). `windowMarginM`
 * is only for the tests, which build again with a wider window to check this one found every
 * outlet.
 */
export function buildWaterMesh(
  holes: readonly PlacedHole[],
  heightAt: (x: number, z: number) => number,
  colourOf: (hole: PlacedHole) => number,
  windowMarginM = WINDOW_MARGIN_M,
): WaterMesh {
  const positions: number[] = [];
  const depth: number[] = [];
  const colour: number[] = [];
  const indices: number[] = [];
  const world = { x: 0, z: 0 };
  const shore: number[] = [];
  const info: WaterPondInfo[] = [];
  let ponds = 0;

  holes.forEach((hole, holeIndex) => {
    const nominal = hole.spec.waterLevel;
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
      minX -= windowMarginM;
      minZ -= windowMarginM;
      maxX += windowMarginM;
      maxZ += windowMarginM;
      const cols = Math.max(2, Math.ceil((maxX - minX) / WATER_CELL_M));
      const rows = Math.max(2, Math.ceil((maxZ - minZ) / WATER_CELL_M));
      const side = cols + 1;
      const count = side * (rows + 1);

      // Every grid vertex, in case a cell keeps it; only the kept ones are emitted.
      const vx = new Float32Array(count);
      const vz = new Float32Array(count);
      const ground = new Float32Array(count);
      let seed = -1;
      let floor = Infinity;
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const k = j * side + i;
          const lx = minX + (i / cols) * (maxX - minX);
          const lz = minZ + (j / rows) * (maxZ - minZ);
          toCourseFrame(hole.placement, lx, lz, world);
          vx[k] = world.x;
          vz[k] = world.z;
          ground[k] = heightAt(world.x, world.z);
          // The deepest ground inside the placed polygon is where the water collects.
          if (ground[k]! < floor && polygonSignedDistance(lx, lz, pond) < 0) {
            floor = ground[k]!;
            seed = k;
          }
        }
      }
      if (seed < 0) continue;

      const spill = spillLevel(ground, side, rows, seed);
      const level = Math.min(nominal, spill - SPILL_FREEBOARD_M);
      if (level < floor + MIN_BASIN_DEPTH_M) continue;

      // The water: ground connected to the deepest point through ground under the level.
      const wet = new Uint8Array(count);
      const stack = [seed];
      wet[seed] = 1;
      let wetCount = 0;
      while (stack.length > 0) {
        const k = stack.pop()!;
        wetCount++;
        const i = k % side;
        const j = (k - i) / side;
        const neighbours = [i < cols ? k + 1 : -1, i > 0 ? k - 1 : -1, j < rows ? k + side : -1, j > 0 ? k - side : -1];
        for (const n of neighbours) {
          if (n >= 0 && !wet[n] && level - ground[n]! > WET_MIN_DEPTH_M) {
            wet[n] = 1;
            stack.push(n);
          }
        }
      }

      // Depth over the ground. A vertex that is not water is given a depth just under 0, so the
      // shader fades the sheet out there; the unclamped value finds the shoreline.
      const vd = new Float32Array(count);
      const raw = new Float32Array(count);
      for (let k = 0; k < count; k++) {
        raw[k] = level - ground[k]!;
        vd[k] = wet[k] ? raw[k]! : Math.min(raw[k]!, NOT_WATER_DEPTH_M);
      }

      // Shoreline crossings: every grid edge with water at one end and bank at the other.
      const cross = (a: number, b: number): void => {
        if (wet[a] === wet[b]) return;
        const w = wet[a] ? a : b;
        const d = wet[a] ? b : a;
        const t = Math.min(1, Math.max(0, raw[w]! / (raw[w]! - raw[d]! || 1)));
        const dx = vx[d]! - vx[w]!;
        const dz = vz[d]! - vz[w]!;
        const length = Math.hypot(dx, dz) || 1;
        shore.push(vx[w]! + dx * t, vz[w]! + dz * t, dx / length, dz / length, level);
      };
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const k = j * side + i;
          if (i < cols) cross(k, k + 1);
          if (j < rows) cross(k, k + side);
        }
      }

      const emitted = new Int32Array(count).fill(-1);
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
              if (!wet[k] || vd[k]! < DEEP_BLOCK_DEPTH_M) deep = false;
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
          if (!wet[a] && !wet[bq] && !wet[c] && !wet[d]) continue;
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
      if (cells > 0) {
        ponds++;
        info.push({ hole: holeIndex, nominal, spill, level, floor, wet: wetCount });
      }
    }
  });

  return {
    positions: new Float32Array(positions),
    depth: new Float32Array(depth),
    colour: new Float32Array(colour),
    indices: new Uint32Array(indices),
    ponds,
    info,
    shore: new Float32Array(shore),
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
