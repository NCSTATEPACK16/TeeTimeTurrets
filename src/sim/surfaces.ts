import { createNoise2D } from "simplex-noise";
import { CUP_XZ, GREEN_RADIUS, TEE_XZ, WATER_LEVEL, heightAt } from "./terrain";

/**
 * Which surface is under a world position, and what that surface does to a ball and a cart.
 *
 * DOM-free and dependency-light on purpose: this is authoritative state that Phase 5's
 * server has to agree with the client about, so it is a pure function of (x, z) and the
 * shared height field -- no authored zone data to keep in sync, and nothing to replicate.
 *
 * This module replaces the unused `SURFACE_TUNING` table that used to sit in
 * physics/Ballistics.ts. There is exactly one surface table and it lives here.
 */

export enum SurfaceId {
  Green = "green",
  Fairway = "fairway",
  Rough = "rough",
  Sand = "sand",
  Water = "water",
}

export interface SurfaceTuning {
  /**
   * Coefficient of rolling resistance for the ball. This is the dominant feel knob: applied
   * as a constant deceleration crr*g, it is what actually brings a ball to rest (see
   * docs/ARCHITECTURE.md §2b). Also sets the steepest grade a ball will hold on that
   * surface, at atan(crr).
   */
  readonly rolling: number;
  /** Multiplier on vertical velocity at each ground contact. Sand kills a bounce; a green keeps it. */
  readonly bounceScale: number;
  /** Multiplier on cart top speed over this surface. Consumed by Phase 2's cart controller. */
  readonly cartSpeedScale: number;
  /** Water is a stroke-and-distance hazard rather than a material. */
  readonly isHazard: boolean;
}

/**
 * Starting values for playtesting, not measured constants. Real-golf anchors: greens run
 * crr ~0.05-0.08, fairway ~0.10-0.13, longer grass higher; a bunker stops a ball almost
 * immediately, which is a very high crr plus a near-dead bounce.
 */
export const SURFACES: Readonly<Record<SurfaceId, SurfaceTuning>> = {
  [SurfaceId.Green]: { rolling: 0.06, bounceScale: 0.9, cartSpeedScale: 1.0, isHazard: false },
  [SurfaceId.Fairway]: { rolling: 0.11, bounceScale: 0.7, cartSpeedScale: 1.0, isHazard: false },
  [SurfaceId.Rough]: { rolling: 0.22, bounceScale: 0.45, cartSpeedScale: 0.72, isHazard: false },
  [SurfaceId.Sand]: { rolling: 0.55, bounceScale: 0.12, cartSpeedScale: 0.5, isHazard: false },
  [SurfaceId.Water]: { rolling: 0.9, bounceScale: 0.05, cartSpeedScale: 0.3, isHazard: true },
};

/**
 * Bunkers come from their own noise channel rather than authored placement, thresholded so
 * they read as scattered patches. Separate seed from the height noise so bunkers do not
 * correlate with hills.
 */
const sandNoise = createNoise2D(() => 0.77);
const SAND_FREQUENCY = 0.055;
const SAND_THRESHOLD = 0.72;

/** Half-width of the mown corridor from tee to cup. Outside it is rough. */
const FAIRWAY_HALF_WIDTH = 26;

/** Squared distance from point (x,z) to the tee->cup segment, for the fairway corridor. */
function distanceToFairwayLine(x: number, z: number): number {
  const ax = TEE_XZ.x;
  const az = TEE_XZ.z;
  const bx = CUP_XZ.x;
  const bz = CUP_XZ.z;
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / lengthSq));
  return Math.hypot(x - (ax + abx * t), z - (az + abz * t));
}

/**
 * Classification order is a priority list, not a blend: water wins over everything (it is
 * defined by height, so it cannot be overridden by a mowing pattern), then the green, then
 * bunkers, then the fairway corridor, and rough is the fallback.
 */
export function surfaceAt(worldX: number, worldZ: number): SurfaceId {
  if (heightAt(worldX, worldZ) < WATER_LEVEL) return SurfaceId.Water;
  if (Math.hypot(worldX - CUP_XZ.x, worldZ - CUP_XZ.z) < GREEN_RADIUS) return SurfaceId.Green;
  if (sandNoise(worldX * SAND_FREQUENCY, worldZ * SAND_FREQUENCY) > SAND_THRESHOLD) {
    return SurfaceId.Sand;
  }
  if (distanceToFairwayLine(worldX, worldZ) < FAIRWAY_HALF_WIDTH) return SurfaceId.Fairway;
  return SurfaceId.Rough;
}

export function tuningAt(worldX: number, worldZ: number): SurfaceTuning {
  return SURFACES[surfaceAt(worldX, worldZ)];
}
