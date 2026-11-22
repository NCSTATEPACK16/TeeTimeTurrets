import { hashChannel, mulberry32 } from "../sim/rng";
import { SHORE_STRIDE } from "./waterMesh";

/**
 * Where cattails stand along the ponds, without three (the Caswell spec, section 3.2).
 *
 * Placed from the water sheet's own shoreline (`WaterMesh.shore`), so they follow the water the
 * player sees and not the pond polygon. Clusters sit on the bank side of the line, a step back
 * from it, in ragged groups with gaps: a continuous hedge of reeds reads as a fence.
 *
 * Deterministic in the seed. Decorative: nothing here is read by the sim.
 */

/** Shore is bucketed into cells this size, metres; a cell holds at most one cluster. */
export const CATTAIL_CELL_M = 6;
/** The share of shoreline cells that grow a cluster. The rest are the gaps. */
const CLUSTER_CHANCE = 0.55;
/** How far back from the waterline a cluster's centre sits, metres. */
const STEP_BACK_MIN_M = 0.5;
const STEP_BACK_MAX_M = 1.3;
/** Clumps per cluster, and how far they spread from its centre, metres. */
const CLUMPS_MIN = 4;
const CLUMPS_MAX = 7;
const CLUMP_SPREAD_M = 1.1;
/**
 * Per-clump scale. The authored clump is 1.4 m tall, so these stand 1.8 to 2.8 m: at the authored
 * size a clump was a few hairlines from the chase camera.
 */
const SCALE_MIN = 1.3;
const SCALE_MAX = 2.0;

/** A shoreline point this near, metres, can put a clump under its water. */
export const SHEET_REACH_M = 6;

/** Hash channel for cattails; 9 is the course woods, 6 the treeline. */
const CATTAIL_CHANNEL = 11;

export interface PlacedCattail {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** The cluster it belongs to, for tests. */
  readonly cluster: number;
}

/**
 * `shore` is `WaterMesh.shore`: x, z, the unit direction toward the bank, and the pond's drawn
 * level, `SHORE_STRIDE` floats a point. A clump is never placed on ground under the water: lower
 * than the highest level among shoreline points within `SHEET_REACH_M`. Ponds overlap where holes
 * do, and a sheet from the next pond over can cover a bank this pond's own level leaves dry.
 */
export function placeCattails(
  shore: Float32Array,
  seed: number,
  heightAt: (x: number, z: number) => number,
): PlacedCattail[] {
  // One representative shore point per cell: the first seen. Shore points arrive in a fixed
  // order, so the choice is deterministic.
  const cells = new Map<string, number>();
  const byCell = new Map<string, number[]>();
  for (let i = 0; i < shore.length; i += SHORE_STRIDE) {
    const key = `${Math.floor(shore[i]! / CATTAIL_CELL_M)},${Math.floor(shore[i + 1]! / CATTAIL_CELL_M)}`;
    if (!cells.has(key)) cells.set(key, i);
    let bucket = byCell.get(key);
    if (bucket === undefined) {
      bucket = [];
      byCell.set(key, bucket);
    }
    bucket.push(i);
  }

  // The highest water level within reach of a point, from the shoreline bucketed on the same grid.
  const waterLevelNear = (x: number, z: number): number => {
    let level = -Infinity;
    const cx = Math.floor(x / CATTAIL_CELL_M);
    const cz = Math.floor(z / CATTAIL_CELL_M);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const i of byCell.get(`${cx + a},${cz + b}`) ?? []) {
          if (Math.hypot(shore[i]! - x, shore[i + 1]! - z) <= SHEET_REACH_M) level = Math.max(level, shore[i + 4]!);
        }
      }
    }
    return level;
  };

  const placed: PlacedCattail[] = [];
  let cluster = 0;
  for (const [key, i] of cells) {
    const [cx, cz] = key.split(",").map(Number) as [number, number];
    const random = mulberry32(hashChannel(seed, CATTAIL_CHANNEL, cx, cz));
    if (random() > CLUSTER_CHANCE) continue;
    const back = STEP_BACK_MIN_M + random() * (STEP_BACK_MAX_M - STEP_BACK_MIN_M);
    const centreX = shore[i]! + shore[i + 2]! * back;
    const centreZ = shore[i + 1]! + shore[i + 3]! * back;
    const clumps = CLUMPS_MIN + Math.floor(random() * (CLUMPS_MAX - CLUMPS_MIN + 1));
    let grown = 0;
    for (let c = 0; c < clumps; c++) {
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random()) * CLUMP_SPREAD_M;
      const yaw = random() * Math.PI * 2;
      const scale = SCALE_MIN + random() * (SCALE_MAX - SCALE_MIN);
      const x = centreX + Math.cos(angle) * reach;
      const z = centreZ + Math.sin(angle) * reach;
      if (heightAt(x, z) < waterLevelNear(x, z)) continue;
      placed.push({ x, z, yaw, scale, cluster });
      grown++;
    }
    if (grown > 0) cluster++;
  }
  return placed;
}
