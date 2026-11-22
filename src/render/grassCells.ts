import type { CourseTerrain } from "../sim/courseTerrain";
import { biomeForIndex } from "../sim/course";
import { hashChannel, mulberry32 } from "../sim/rng";
import { SurfaceId } from "../sim/surfaceId";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { PALETTE_BIOME_ORDER, groundColourAt } from "./groundPalette";
import type { LinearRgb } from "./groundPalette";
import { GROUND_EDGES } from "./groundShader";
import { groundWarp } from "./groundWarp";
import { woodsDensityAt } from "./woodsPlacement";
import type { WoodsDensity } from "./woodsPlacement";

/**
 * Where grass tufts stand (the Caswell spec, D8), without three. `grassCarpet.ts` draws them.
 *
 * The ground near the camera is cut into `CELL_M` cells. A cell's tufts come from a stream seeded
 * on its own coordinates, so a cell left and re-entered grows the same grass, and filling one never
 * depends on which others are resident.
 *
 * A tuft stands only in the rough -- the sim calls it rough, and the corridor weight, read through
 * the same edge warp the ground shader draws with (`groundWarp`), is past the fairway's cut line --
 * and never on sand, water, a bank too steep for turf, or the woods floor. It thins under the
 * woods and grows at half density in the first cut. Its colour is the ground's under it
 * (`groundColourAt`).
 */

/** Metres per side of a cell. */
export const CELL_M = 12;
/** Cells from the camera's own to the ring's edge. */
export const RING_CELLS = 4;
/** Metres from the camera at which tufts have shrunk to nothing (`grassCarpet.ts`' fade). */
export const RING_M = RING_CELLS * CELL_M;
/** Floats per tuft in a filled cell: x, y, z, yaw, height, r, g, b. */
export const TUFT_STRIDE = 8;

/** Tuft heights, metres. */
const HEIGHT_MIN_M = 0.18;
const HEIGHT_MAX_M = 0.34;
/** The warped corridor weight a tuft needs: just past the fairway's cut line. */
const MIN_CORRIDOR = 0.34;
/** Woods density at which the woods floor has taken over and no tuft stands. */
const MAX_WOODS = 0.5;
/** Steepest ground a tuft stands on, as the normal's y: 35 degrees. */
const MIN_UP = Math.cos((35 * Math.PI) / 180);
/** Keep probability in the first cut, against the rough's. */
const FIRST_CUT_SHARE = 0.5;
/** How much lighter than the ground a tuft is drawn. The blade tips lighten further in the mesh. */
const TUFT_LIGHTEN = 1.04;

/** Hash channel of the tufts: `grep -rn "_CHANNEL = " src` shows 3-9 and 11 taken. */
const GRASS_CHANNEL = 12;

/** Tufts a cell can hold at `density` tufts per square metre: the size of its slot. */
export function tuftsPerCell(density: number): number {
  return Math.ceil(density * CELL_M * CELL_M);
}

/** What the ground is at one point, as far as a tuft cares. Filled by a `TuftQuery`. */
export interface TuftGround {
  surface: SurfaceId;
  /** The mask's weights, green and corridor read through the edge warp. */
  green: number;
  corridor: number;
  sand: number;
  water: number;
  woods: number;
  /** The ground normal's y. */
  up: number;
  y: number;
  /** Biome shares in `PALETTE_BIOME_ORDER`. */
  readonly biome: Float32Array;
}

export interface TuftQuery {
  readonly seed: number;
  /** Fill `out` for the point, or return false where there is no ground to grow on. */
  at(x: number, z: number, out: TuftGround): boolean;
}

export function createTuftGround(): TuftGround {
  return { surface: SurfaceId.Rough, green: 1, corridor: 1, sand: 0, water: 0, woods: 0, up: 1, y: 0, biome: new Float32Array(3) };
}

/**
 * The query over the shipped course: its surfaces, its heights, the holes' biome shares and the
 * woods floor. All scratch is allocated here, once.
 */
export function createCourseTuftQuery(
  terrain: CourseTerrain,
  surfaces: Surfaces,
  woods: WoodsDensity | null,
  seed: number,
): TuftQuery {
  const weights = createSurfaceWeights();
  const shares = new Float32Array(terrain.holes.length);
  const holeBiome = terrain.holes.map((hole) => PALETTE_BIOME_ORDER.indexOf(biomeForIndex(hole.spec.index)));
  const warp = { x: 0, z: 0 };
  const { bounds } = terrain;
  const STEP = 0.5;
  return {
    seed,
    at(x, z, out) {
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
      out.surface = surfaces.surfaceAt(x, z);
      surfaces.weightsAt(x, z, weights);
      out.sand = weights.sand;
      out.water = weights.water;
      // Green and corridor through the warp, as the shader reads them; sand and water not.
      groundWarp(x, z, warp);
      surfaces.weightsAt(x + warp.x, z + warp.z, weights);
      out.green = weights.green;
      out.corridor = weights.corridor;
      out.woods = woods === null ? 0 : woodsDensityAt(woods, x, z);
      out.y = terrain.heightAt(x, z);
      const dx = terrain.heightAt(x + STEP, z) - terrain.heightAt(x - STEP, z);
      const dz = terrain.heightAt(x, z + STEP) - terrain.heightAt(x, z - STEP);
      out.up = (2 * STEP) / Math.sqrt(dx * dx + dz * dz + 4 * STEP * STEP);
      out.biome.fill(0);
      terrain.weightsInto(x, z, shares);
      for (let i = 0; i < shares.length; i++) {
        const share = shares[i]!;
        if (share > 0) out.biome[holeBiome[i]!]! += share;
      }
      return true;
    },
  };
}

const ground = createTuftGround();
const colour: LinearRgb = { r: 0, g: 0, b: 0 };
const sample = {
  x: 0,
  z: 0,
  green: 0,
  corridor: 0,
  sand: 0,
  water: 0,
  biome: ground.biome as ArrayLike<number>,
  woods: 0,
  up: 1,
};

/**
 * Write cell (`cellX`, `cellZ`)'s tufts into `out`, `TUFT_STRIDE` floats each, and return how
 * many. `out` must hold `tuftsPerCell(density)` tufts. Allocates nothing but its seeded stream.
 */
export function fillCell(cellX: number, cellZ: number, density: number, query: TuftQuery, out: Float32Array): number {
  const candidates = tuftsPerCell(density);
  const random = mulberry32(hashChannel(query.seed, GRASS_CHANNEL, cellX, cellZ));
  const minX = cellX * CELL_M;
  const minZ = cellZ * CELL_M;
  let count = 0;
  for (let i = 0; i < candidates; i++) {
    // Every draw is taken whether or not the tuft is kept, so one rule never moves another tuft.
    const x = minX + random() * CELL_M;
    const z = minZ + random() * CELL_M;
    const yaw = random() * Math.PI * 2;
    const height = HEIGHT_MIN_M + random() * (HEIGHT_MAX_M - HEIGHT_MIN_M);
    const keep = random();

    if (!query.at(x, z, ground)) continue;
    if (ground.surface !== SurfaceId.Rough) continue;
    if (ground.corridor <= MIN_CORRIDOR || ground.woods >= MAX_WOODS) continue;
    if (ground.water > 0 || ground.sand > 0 || ground.up < MIN_UP) continue;
    const firstCut = ground.corridor < GROUND_EDGES.firstCutTo;
    if (keep >= (1 - ground.woods) * (firstCut ? FIRST_CUT_SHARE : 1)) continue;

    sample.x = x;
    sample.z = z;
    sample.green = ground.green;
    sample.corridor = ground.corridor;
    sample.sand = ground.sand;
    sample.water = ground.water;
    sample.woods = ground.woods;
    sample.up = ground.up;
    groundColourAt(sample, colour);

    const o = count * TUFT_STRIDE;
    out[o] = x;
    out[o + 1] = ground.y;
    out[o + 2] = z;
    out[o + 3] = yaw;
    out[o + 4] = height;
    out[o + 5] = colour.r * TUFT_LIGHTEN;
    out[o + 6] = colour.g * TUFT_LIGHTEN;
    out[o + 7] = colour.b * TUFT_LIGHTEN;
    count++;
  }
  return count;
}

/** Cell offsets in the ring, nearest first: every cell whose centre is within 4.5 cells. */
const RING_OFFSETS: readonly (readonly [number, number])[] = (() => {
  const reach = RING_CELLS + 0.5;
  const offsets: [number, number][] = [];
  for (let dz = -RING_CELLS; dz <= RING_CELLS; dz++) {
    for (let dx = -RING_CELLS; dx <= RING_CELLS; dx++) {
      if (dx * dx + dz * dz <= reach * reach) offsets.push([dx, dz]);
    }
  }
  // Stable on ties, so the order is the same on every engine.
  return offsets
    .map((o, i) => ({ o, i, d: o[0] * o[0] + o[1] * o[1] }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((e) => e.o);
})();

/** Cells in the ring. */
export const RING_SIZE = RING_OFFSETS.length;

/** The cell holding a world coordinate. */
export function cellOf(v: number): number {
  return Math.floor(v / CELL_M);
}

/**
 * The ring's cells around the camera, nearest first, as x, z pairs into `out` (which holds
 * `2 * RING_SIZE`). Returns how many cells. Never allocates.
 */
export function ringCells(cameraX: number, cameraZ: number, out: Int32Array): number {
  const cx = cellOf(cameraX);
  const cz = cellOf(cameraZ);
  for (let i = 0; i < RING_OFFSETS.length; i++) {
    out[i * 2] = cx + RING_OFFSETS[i]![0];
    out[i * 2 + 1] = cz + RING_OFFSETS[i]![1];
  }
  return RING_OFFSETS.length;
}
