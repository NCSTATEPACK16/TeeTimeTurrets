import type { BiomeId } from "../sim/course";
import { biomeForIndex } from "../sim/course";
import { metresNorthOf } from "../sim/courseBarrier";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { CourseTerrain } from "../sim/courseTerrain";
import type { Vec2 } from "../sim/mapGeometry";
import { hashChannel, mulberry32 } from "../sim/rng";
import { SurfaceId } from "../sim/surfaceId";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { WOODS_WEIGHT } from "../sim/terrain";
import { BIOMES } from "./biomes";

/**
 * Where the course woods stand, without three (Stage 3.5b).
 *
 * The art target (`restyle-chase-01.jpg`) has the rough dotted with **clumps of three to seven
 * conifers**, and the ground between two holes grown into denser stands that read as cover. The
 * old placement was a jittered 6 m grid with a coin toss per cell: an even sprinkle of single
 * trees, which reads as neither. This places clumps instead:
 *
 * - **Clump centres** on a jittered grid of `CLUMP_PITCH_M`, each occupied with a probability
 *   chosen so the biome's `treeDensity` (trees per 1000 m^2) still holds on average.
 * - **Members** thrown around the centre by dart throwing against every tree already standing, so
 *   no two trunks are closer than `MIN_SPACING_M` across the whole course -- blue noise, not a
 *   grid -- and a clump never overlaps its neighbour into a single blob.
 * - **Stands** where the ground is shared between two holes (the second-largest hole share is
 *   real): those clumps are likelier and bigger, which is what turns the belt between two
 *   fairways into a wood.
 *
 * A tree only stands on ground the sim calls rough and that is deep enough into it to be woods
 * (`WOODS_WEIGHT`, the same number bunkers are kept under), so fairway, green, sand, water,
 * bridges and paths are all refused by one test.
 *
 * Deterministic in the course seed. Each clump draws from its own stream, keyed on its cell, so
 * a rule that rejects one tree never moves another clump's.
 */

/** Clump grid pitch, metres. */
export const CLUMP_PITCH_M = 16;
/** No two trunks closer than this, metres, anywhere on the course. */
export const MIN_SPACING_M = 2.6;
/** Clump size, trees, before the ground rejects any: 3 to 7, per the art target. */
const CLUMP_MIN = 3;
const CLUMP_MAX = 7;
/** A stand's size: the cover between two holes. */
const STAND_MIN = 6;
const STAND_MAX = 11;
/** How much likelier a clump is on shared ground than the biome's density alone gives. */
const STAND_BOOST = 1.9;
/** Second-largest hole share above which ground counts as between two holes. */
const SHARED_SHARE = 0.18;
/** Dart throws per tree before a clump settles for fewer. */
const THROWS_PER_TREE = 8;
/** Per-tree scale spread around the biome's tree height. */
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.3;
/** Of a conifer biome's clumps, the share that are all conifer. The rest mix in the oak. */
const PURE_CONIFER_SHARE = 0.8;
/** How far from the clubhouse centre the woods stay clear: the complex, barns, pads and lot. */
export const CLUBHOUSE_CLEAR_M = 55;

/** Hash channel of the course woods, beside the treeline's 6. Shared with the old placement. */
const COURSE_WOODS_CHANNEL = 9;

export interface WoodsOptions {
  readonly seed: number;
  readonly southBoundary?: SouthBoundary | undefined;
  readonly clubhouse?: Vec2 | undefined;
}

export interface PlacedTree {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Height in metres (the species are authored at unit height). */
  readonly height: number;
  /** Yaw, radians. */
  readonly turn: number;
  /** Which of the biome's two species: 0 or 1. */
  readonly species: 0 | 1;
  readonly biome: BiomeId;
  /** 0..1, for the per-instance colour variation. */
  readonly tint: number;
  /** The clump it belongs to, so a cap can drop whole clumps rather than thin every one. */
  readonly clump: number;
}

export function placeCourseWoods(course: CourseTerrain, surfaces: Surfaces, options: WoodsOptions): PlacedTree[] {
  const weights = createSurfaceWeights();
  const shares = new Float32Array(course.holes.length);
  const holeBiome = course.holes.map((hole) => biomeForIndex(hole.spec.index));
  const { bounds } = course;
  const clear2 = CLUBHOUSE_CLEAR_M * CLUBHOUSE_CLEAR_M;
  const spacing2 = MIN_SPACING_M * MIN_SPACING_M;

  // Every standing trunk, bucketed by a grid of the spacing so a dart checks nine buckets.
  const buckets = new Map<number, PlacedTree[]>();
  const bucketKey = (bx: number, bz: number): number => bx * 100003 + bz;
  const crowded = (x: number, z: number): boolean => {
    const bx = Math.floor(x / MIN_SPACING_M);
    const bz = Math.floor(z / MIN_SPACING_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const t of buckets.get(bucketKey(bx + dx, bz + dz)) ?? []) {
          const ex = t.x - x;
          const ez = t.z - z;
          if (ex * ex + ez * ez < spacing2) return true;
        }
      }
    }
    return false;
  };

  const plantable = (x: number, z: number): boolean => {
    if (surfaces.surfaceAt(x, z) !== SurfaceId.Rough) return false;
    surfaces.weightsAt(x, z, weights);
    if (weights.corridor < WOODS_WEIGHT || weights.water > 0 || weights.sand > 0) return false;
    if (options.southBoundary && metresNorthOf(options.southBoundary, x, z) <= 0) return false;
    if (options.clubhouse) {
      const dx = x - options.clubhouse.x;
      const dz = z - options.clubhouse.z;
      if (dx * dx + dz * dz < clear2) return false;
    }
    return true;
  };

  const trees: PlacedTree[] = [];
  const cols = Math.floor((bounds.maxX - bounds.minX) / CLUMP_PITCH_M);
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / CLUMP_PITCH_M);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const random = mulberry32(hashChannel(options.seed, COURSE_WOODS_CHANNEL, cell));
      const occupancy = random();
      const cx = bounds.minX + (col + random()) * CLUMP_PITCH_M;
      const cz = bounds.minZ + (row + random()) * CLUMP_PITCH_M;

      const owner = course.weightsInto(cx, cz, shares);
      if (owner < 0) continue;
      let second = 0;
      for (let i = 0; i < shares.length; i++) if (i !== owner && shares[i]! > second) second = shares[i]!;
      const stand = second > SHARED_SHARE;

      const biome = holeBiome[owner]!;
      const palette = BIOMES[biome];
      const meanSize = stand ? (STAND_MIN + STAND_MAX) / 2 : (CLUMP_MIN + CLUMP_MAX) / 2;
      // Trees a pitch-square of this biome should hold, over trees a clump holds.
      let chance = (palette.treeDensity * CLUMP_PITCH_M * CLUMP_PITCH_M) / 1000 / meanSize;
      if (stand) chance *= STAND_BOOST;
      if (occupancy > chance) continue;

      const size = stand
        ? STAND_MIN + Math.floor(random() * (STAND_MAX - STAND_MIN + 1))
        : CLUMP_MIN + Math.floor(random() * (CLUMP_MAX - CLUMP_MIN + 1));
      const radius = MIN_SPACING_M * (0.9 + Math.sqrt(size) * 0.75);
      const pureConifer = palette.treeForm === "conifer" && random() < PURE_CONIFER_SHARE;
      const clumpTint = random();

      let planted = 0;
      for (let t = 0; t < size * THROWS_PER_TREE && planted < size; t++) {
        // Uniform over the disc, so the clump has no dense core it did not choose.
        const r = radius * Math.sqrt(random());
        const a = random() * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const scaleDraw = random();
        const turn = random() * Math.PI * 2;
        const speciesDraw = random();
        const tintDraw = random();
        if (crowded(x, z) || !plantable(x, z)) continue;

        // Taller toward the clump's middle: a stand reads as one mass with a crown, not a hedge.
        const centred = 1 - r / radius;
        const scale = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * (0.55 * scaleDraw + 0.45 * centred);
        const tree: PlacedTree = {
          x,
          y: course.heightAt(x, z),
          z,
          height: palette.treeHeight * scale,
          turn,
          species: pureConifer ? 0 : speciesDraw < 0.5 ? 0 : 1,
          biome,
          // A clump shares most of its tint, so it reads as one group of one age.
          tint: clumpTint * 0.6 + tintDraw * 0.4,
          clump: cell,
        };
        trees.push(tree);
        const key = bucketKey(Math.floor(x / MIN_SPACING_M), Math.floor(z / MIN_SPACING_M));
        let bucket = buckets.get(key);
        if (bucket === undefined) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(tree);
        planted++;
      }
    }
  }
  return trees;
}

/**
 * The same trees, clump by clump in a seeded shuffle: the order the instance buffers are filled
 * in. A quality cap draws the first N, so it drops whole clumps spread evenly over the course,
 * instead of thinning every clump to a stray tree or -- the old row-major order -- starving
 * whichever end of the course was placed last.
 */
export function clumpOrder(trees: readonly PlacedTree[], seed: number): PlacedTree[] {
  const byClump = new Map<number, PlacedTree[]>();
  for (const tree of trees) {
    let clump = byClump.get(tree.clump);
    if (clump === undefined) {
      clump = [];
      byClump.set(tree.clump, clump);
    }
    clump.push(tree);
  }
  const clumps = [...byClump.values()];
  const random = mulberry32(hashChannel(seed, COURSE_WOODS_CHANNEL, -1));
  for (let i = clumps.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [clumps[i], clumps[j]] = [clumps[j]!, clumps[i]!];
  }
  return clumps.flat();
}

/**
 * How wooded the ground is, 0..1, on a coarse grid (the Caswell spec, D7): pine straw is drawn
 * where this is high, and grass tufts thin out as it rises. Built once from the placed trees.
 *
 * Each tree stamps a soft disc a little wider than its crown (`stampRadius`), the stamps add and
 * clamp at 1, and one 3 x 3 blur rounds the steps off. Read bilinearly with `woodsDensityAt`.
 *
 * Pure: no three. Stage 6's route-finding can ask it where the woods are.
 */
export interface WoodsDensity {
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  /** Row-major, `rows * cols`, 0..1. */
  readonly values: Float32Array;
}

/** Metres per density cell. Coarse on purpose: the boundary is meant to feather. */
export const WOODS_CELL_M = 4;

/** Share of a stamp's radius inside which it is full; it falls smoothly to nothing at the radius. */
const STAMP_FULL = 0.85;

/** A tree's stamp radius, metres: a little wider than the crown, so the floor shows round it. */
export function stampRadius(height: number): number {
  return 1.6 * MIN_SPACING_M + height * 0.25;
}

export function buildWoodsDensity(
  trees: readonly { readonly x: number; readonly z: number; readonly height: number }[],
  bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
): WoodsDensity {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / WOODS_CELL_M) + 1);
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / WOODS_CELL_M) + 1);
  const raw = new Float32Array(cols * rows);
  for (const tree of trees) {
    const radius = stampRadius(tree.height);
    const inner = radius * STAMP_FULL;
    // Cell centres sit on the grid points: cell (c, r) is the value at minX + c * cell.
    const c0 = Math.max(0, Math.floor((tree.x - radius - bounds.minX) / WOODS_CELL_M));
    const c1 = Math.min(cols - 1, Math.ceil((tree.x + radius - bounds.minX) / WOODS_CELL_M));
    const r0 = Math.max(0, Math.floor((tree.z - radius - bounds.minZ) / WOODS_CELL_M));
    const r1 = Math.min(rows - 1, Math.ceil((tree.z + radius - bounds.minZ) / WOODS_CELL_M));
    for (let r = r0; r <= r1; r++) {
      const dz = bounds.minZ + r * WOODS_CELL_M - tree.z;
      for (let c = c0; c <= c1; c++) {
        const dx = bounds.minX + c * WOODS_CELL_M - tree.x;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= radius) continue;
        const t = d <= inner ? 0 : (d - inner) / (radius - inner);
        raw[r * cols + c] = Math.min(1, raw[r * cols + c]! + 1 - t * t * (3 - 2 * t));
      }
    }
  }
  // One 3 x 3 tent blur (1-2-1 each way), clamped at the grid's edge.
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const k = (dr === 0 ? 2 : 1) * (dc === 0 ? 2 : 1);
          sum += raw[rr * cols + cc]! * k;
          n += k;
        }
      }
      values[r * cols + c] = Math.min(1, Math.max(0, sum / n));
    }
  }
  return { minX: bounds.minX, minZ: bounds.minZ, cols, rows, values };
}

/** Bilinear read of the density, 0 off the grid. Never allocates. */
export function woodsDensityAt(field: WoodsDensity, x: number, z: number): number {
  const fx = (x - field.minX) / WOODS_CELL_M;
  const fz = (z - field.minZ) / WOODS_CELL_M;
  if (fx < 0 || fz < 0 || fx > field.cols - 1 || fz > field.rows - 1) return 0;
  const c = Math.min(field.cols - 2, Math.floor(fx));
  const r = Math.min(field.rows - 2, Math.floor(fz));
  if (c < 0 || r < 0) return field.values[0]!;
  const tx = fx - c;
  const tz = fz - r;
  const v = field.values;
  const i = r * field.cols + c;
  const top = v[i]! + (v[i + 1]! - v[i]!) * tx;
  const bottom = v[i + field.cols]! + (v[i + field.cols + 1]! - v[i + field.cols]!) * tx;
  return top + (bottom - top) * tz;
}
