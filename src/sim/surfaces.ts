import { createNoise2D } from "simplex-noise";
import { legacyHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { hashChannel, mulberry32 } from "./rng";
import { GREEN_RADIUS, LEGACY_TERRAIN_SOURCES, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";

/**
 * Which surface is under a world position, and what that surface does to a ball and a cart.
 *
 * DOM-free and dependency-light on purpose: this is authoritative state that Phase 5's server
 * has to agree with the client about, so it is a pure function of (x, z) and the shared height
 * field -- no authored zone data to keep in sync, and nothing to replicate.
 *
 * There is exactly one surface table and it lives here.
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
   * Coefficient of rolling resistance for the ball. This is the dominant feel knob: applied as
   * a constant deceleration crr*g, it is what actually brings a ball to rest (see
   * docs/ARCHITECTURE.md §2b). Also sets the steepest grade a ball will hold on that surface,
   * at atan(crr).
   */
  readonly rolling: number;
  /** Multiplier on vertical velocity at each ground contact. Sand kills a bounce; a green keeps it. */
  readonly bounceScale: number;
  /** Multiplier on cart top speed over this surface. */
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
 * Bunkers come from their own noise channel rather than authored placement, thresholded so they
 * read as scattered patches. Channel 1 of the spec's seed, separate from the height channel so
 * bunkers do not correlate with hills.
 */
const SAND_FREQUENCY = 0.055;
const SAND_THRESHOLD = 0.72;

/** Half-width of the mown corridor from tee to cup. Replaced by the spline corridor in §5. */
const FAIRWAY_HALF_WIDTH = 26;

export function sandChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 1);
}

export interface SurfaceSources {
  readonly sand: () => number;
}

export interface Surfaces {
  /** Discrete. Feeds the HUD readout, Phase 4's minimap, and render colouring. */
  surfaceAt(worldX: number, worldZ: number): SurfaceId;
  /** Continuous from §5 onward; still a table lookup here. */
  tuningAt(worldX: number, worldZ: number): SurfaceTuning;
}

export function createSurfaces(
  spec: HoleSpec,
  terrain: Terrain,
  sources?: SurfaceSources,
): Surfaces {
  const random = sources?.sand ?? mulberry32(sandChannel(spec));
  const sandNoise = createNoise2D(random);

  /** Squared-free distance from (x, z) to the tee->cup segment, for the fairway corridor. */
  function distanceToFairwayLine(x: number, z: number): number {
    const ax = spec.tee.x;
    const az = spec.tee.z;
    const abx = spec.cup.x - ax;
    const abz = spec.cup.z - az;
    const lengthSq = abx * abx + abz * abz;
    const t =
      lengthSq === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / lengthSq));
    return Math.hypot(x - (ax + abx * t), z - (az + abz * t));
  }

  /**
   * Classification order is a priority list, not a blend: water wins over everything (it is
   * defined by height, so it cannot be overridden by a mowing pattern), then the green, then
   * bunkers, then the fairway corridor, and rough is the fallback.
   */
  function surfaceAt(worldX: number, worldZ: number): SurfaceId {
    if (terrain.heightAt(worldX, worldZ) < spec.waterLevel) return SurfaceId.Water;
    if (Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z) < GREEN_RADIUS) {
      return SurfaceId.Green;
    }
    if (sandNoise(worldX * SAND_FREQUENCY, worldZ * SAND_FREQUENCY) > SAND_THRESHOLD) {
      return SurfaceId.Sand;
    }
    if (distanceToFairwayLine(worldX, worldZ) < FAIRWAY_HALF_WIDTH) return SurfaceId.Fairway;
    return SurfaceId.Rough;
  }

  function tuningAt(worldX: number, worldZ: number): SurfaceTuning {
    return SURFACES[surfaceAt(worldX, worldZ)];
  }

  return { surfaceAt, tuningAt };
}

// ---------------------------------------------------------------------------------------
// Temporary compatibility shims, matching terrain.ts's. Deleted in Task 7.
// ---------------------------------------------------------------------------------------

/** The shipped hole's literal sand noise source: createNoise2D(() => 0.77). */
export const LEGACY_SURFACE_SOURCES: SurfaceSources = { sand: () => 0.77 };

const legacySpec = legacyHoleSpec();
const legacySurfaces = createSurfaces(
  legacySpec,
  createTerrain(legacySpec, LEGACY_TERRAIN_SOURCES),
  LEGACY_SURFACE_SOURCES,
);

export function surfaceAt(worldX: number, worldZ: number): SurfaceId {
  return legacySurfaces.surfaceAt(worldX, worldZ);
}

export function tuningAt(worldX: number, worldZ: number): SurfaceTuning {
  return legacySurfaces.tuningAt(worldX, worldZ);
}
