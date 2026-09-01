import { createNoise2D } from "simplex-noise";
import type { HoleSpec } from "./course";
import { hashChannel, mulberry32 } from "./rng";
import { createNearestPoint } from "./spline";
import type { NearestPoint } from "./spline";
import {
  BLEND_WIDTH,
  GREEN_BLEND,
  GREEN_RADIUS,
  HALF_WIDTH,
  smoothstep01,
} from "./terrain";
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
 * The scratch `tuningAt` writes into. `SurfaceTuning` stays readonly because it is what callers
 * consume; this sibling exists because `Sim.step` calls `tuningAt` every tick and a blended
 * result is a new value, which would allocate. Matches the `Sim.muzzle(out: Vec3)` idiom.
 */
export interface MutableSurfaceTuning {
  rolling: number;
  bounceScale: number;
  cartSpeedScale: number;
  isHazard: boolean;
}

export function createSurfaceTuning(): MutableSurfaceTuning {
  return { rolling: 0, bounceScale: 0, cartSpeedScale: 0, isHazard: false };
}

/** Nested lerp, green -> fairway -> rough, using the same weights the height budget uses. */
function blendMown(
  green: number,
  fairway: number,
  rough: number,
  tGreen: number,
  tCorridor: number,
): number {
  const mown = green + (fairway - green) * tGreen;
  return mown + (rough - mown) * tCorridor;
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

export function sandChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 1);
}

export interface SurfaceSources {
  readonly sand: () => number;
}

export interface Surfaces {
  /** Discrete. Feeds the HUD readout, Phase 4's minimap, and render colouring. */
  surfaceAt(worldX: number, worldZ: number): SurfaceId;
  /** Continuous, per Task 11: a blended value, not a table lookup. */
  tuningAt(worldX: number, worldZ: number, out: MutableSurfaceTuning): void;
}

export function createSurfaces(
  spec: HoleSpec,
  terrain: Terrain,
  sources?: SurfaceSources,
): Surfaces {
  const random = sources?.sand ?? mulberry32(sandChannel(spec));
  const sandNoise = createNoise2D(random);

  // Closure-owned scratch: both functions run inside the fixed tick.
  const nearestScratch: NearestPoint = createNearestPoint();

  /** 0 on the green, 1 off it. */
  function greenWeight(worldX: number, worldZ: number): number {
    const toCup = Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z);
    return smoothstep01((toCup - GREEN_RADIUS) / GREEN_BLEND);
  }

  /** 0 on the mown corridor, 1 in full rough. Fills `nearestScratch` as a side effect. */
  function corridorWeight(worldX: number, worldZ: number): number {
    terrain.spline.nearestInto(worldX, worldZ, nearestScratch);
    return smoothstep01((nearestScratch.distance - HALF_WIDTH) / BLEND_WIDTH);
  }

  /**
   * Classification order is a priority list, not a blend: water wins over everything (it is
   * defined by height, so it cannot be overridden by a mowing pattern), then the green, then
   * bunkers, then the corridor, and rough is the fallback.
   *
   * The corridor's visual edge sits where the blend crosses halfway -- smoothstep01 is 0.5 at
   * its midpoint, so `tCorridor < 0.5` is the same line the physics is already half-way across.
   * One source for the edge rather than a separate visual constant to drift.
   */
  function surfaceAt(worldX: number, worldZ: number): SurfaceId {
    if (terrain.heightAt(worldX, worldZ) < spec.waterLevel) return SurfaceId.Water;
    if (Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z) < GREEN_RADIUS) {
      return SurfaceId.Green;
    }
    if (sandNoise(worldX * SAND_FREQUENCY, worldZ * SAND_FREQUENCY) > SAND_THRESHOLD) {
      return SurfaceId.Sand;
    }
    return corridorWeight(worldX, worldZ) < 0.5 ? SurfaceId.Fairway : SurfaceId.Rough;
  }

  /**
   * Continuous, unlike `surfaceAt`. rolling, bounceScale and cartSpeedScale are smoothstep-
   * blended across the green<->fairway and fairway<->rough boundaries using exactly the weights
   * the height field's budget uses, so the visual edge and the physical gradient come from one
   * source.
   *
   * Sand and water keep hard edges. A bunker lip and a water margin are supposed to be abrupt,
   * and blending them would make a ball drift to a halt in a bunker rather than stop in it.
   */
  function tuningAt(worldX: number, worldZ: number, out: MutableSurfaceTuning): void {
    const id = surfaceAt(worldX, worldZ);
    if (id === SurfaceId.Sand || id === SurfaceId.Water) {
      const hard = SURFACES[id];
      out.rolling = hard.rolling;
      out.bounceScale = hard.bounceScale;
      out.cartSpeedScale = hard.cartSpeedScale;
      out.isHazard = hard.isHazard;
      return;
    }

    const tGreen = greenWeight(worldX, worldZ);
    const tCorridor = corridorWeight(worldX, worldZ);
    const green = SURFACES[SurfaceId.Green];
    const fairway = SURFACES[SurfaceId.Fairway];
    const rough = SURFACES[SurfaceId.Rough];

    out.rolling = blendMown(green.rolling, fairway.rolling, rough.rolling, tGreen, tCorridor);
    out.bounceScale = blendMown(
      green.bounceScale,
      fairway.bounceScale,
      rough.bounceScale,
      tGreen,
      tCorridor,
    );
    out.cartSpeedScale = blendMown(
      green.cartSpeedScale,
      fairway.cartSpeedScale,
      rough.cartSpeedScale,
      tGreen,
      tCorridor,
    );
    out.isHazard = false;
  }

  return { surfaceAt, tuningAt };
}
