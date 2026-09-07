import { isWaterAt } from "./course";
import type { HoleSpec } from "./course";
import { ellipseEdgeDistance, pointInEllipse } from "./hazards";
import { hashChannel } from "./rng";
import { createNearestPoint } from "./spline";
import type { NearestPoint } from "./spline";
import { BLEND_WIDTH, GREEN_BLEND, halfWidthAt, smoothstep01 } from "./terrain";
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

/**
 * The raw blend weights behind a classification, exposed so a consumer can colour or shade the
 * ground from exactly what the physics blends with.
 *
 * This exists to prevent a second source of truth. The renderer needs the corridor and green
 * falloffs to draw a mown edge; recomputing them in `src/render/**` would mean the visible edge
 * and the physical one could drift apart silently. Reading them from here means they cannot.
 */
export interface SurfaceWeights {
  /** 0 on the putting green, 1 well off it. Smoothstep across GREEN_BLEND. */
  green: number;
  /** 0 on the mown corridor, 1 in full rough. Smoothstep across BLEND_WIDTH. */
  corridor: number;
  /** 1 where `surfaceAt` returns Sand, else 0. Hard-edged on purpose -- a bunker lip is abrupt. */
  sand: number;
  /** 1 where `surfaceAt` returns Water, else 0. */
  water: number;
}

export function createSurfaceWeights(): SurfaceWeights {
  return { green: 0, corridor: 0, sand: 0, water: 0 };
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
 * Channel 1 of the spec's seed. Bunker *placement* now happens in `course.ts` against a validated
 * routing (a bunker at "the fairway elbow" has no meaning until the elbow exists), so this is the
 * channel that placement draws from rather than one this module samples.
 *
 * **What used to be here:** a simplex field at `SAND_FREQUENCY = 0.055` thresholded at 0.72, so
 * sand was any point where a noise function happened to be high. That produced 3.6% of the *mown
 * corridor* as sand -- tan speckles scattered across every fairway rather than hazards anyone
 * placed (docs/COURSE_PIPELINE.md §5.1). It is gone, not merely tuned: no threshold value makes a
 * noise field express "guard the aggressive line".
 */
export function sandChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 1);
}

export interface Surfaces {
  /** Discrete. Feeds the HUD readout, Phase 4's minimap, and render colouring. */
  surfaceAt(worldX: number, worldZ: number): SurfaceId;
  /** Continuous, per Task 11: a blended value, not a table lookup. */
  tuningAt(worldX: number, worldZ: number, out: MutableSurfaceTuning): void;
  /**
   * The blend weights `tuningAt` uses, and the hard sand/water flags `surfaceAt` decides from.
   * Written into `out`; this is called once per texel when the renderer bakes its surface mask,
   * and that is a loop worth not allocating in either.
   */
  weightsAt(worldX: number, worldZ: number, out: SurfaceWeights): void;
}

export function createSurfaces(spec: HoleSpec, terrain: Terrain): Surfaces {
  // Closure-owned scratch: both functions run inside the fixed tick.
  const nearestScratch: NearestPoint = createNearestPoint();

  /**
   * 0 on the green, 1 off it.
   *
   * Measured from the green *ellipse's* rim rather than a radius about the cup, so an elongated
   * or angled green blends out along its own shape. For a circular green of GREEN_RADIUS centred
   * on the cup -- what every hole had before Tier 2 -- `ellipseEdgeDistance` is exact and this
   * reduces to the previous expression term for term.
   */
  function greenWeight(worldX: number, worldZ: number): number {
    return smoothstep01(ellipseEdgeDistance(worldX, worldZ, spec.green) / GREEN_BLEND);
  }

  /**
   * 0 on the mown corridor, 1 in full rough. Fills `nearestScratch` as a side effect.
   *
   * The width comes from `spec.corridor` via the same `halfWidthAt` the height field carves with,
   * so a pinched corridor is narrower to the physics and to the renderer at exactly the same
   * place. A second interpolation here would be a second corridor.
   */
  function corridorWeight(worldX: number, worldZ: number): number {
    terrain.spline.nearestInto(worldX, worldZ, nearestScratch);
    const half = halfWidthAt(spec.corridor, nearestScratch.t);
    return smoothstep01((nearestScratch.distance - half) / BLEND_WIDTH);
  }

  /** True inside any placed bunker. */
  function isSand(worldX: number, worldZ: number): boolean {
    for (const b of spec.bunkers) {
      if (pointInEllipse(worldX, worldZ, b)) return true;
    }
    return false;
  }

  /**
   * Classification order is a priority list, not a blend: the green wins, then water, then
   * bunkers, then the corridor, and rough is the fallback.
   *
   * **The green and water swapped places in Tier 2, and the reason the old order existed went
   * away rather than being overruled.** Water used to be defined by height, so it could not be
   * allowed to lose to a mowing pattern -- a green painted over a lake would have been a green
   * you could putt on the bottom of. Now that water is a placed polygon, a green inside one is
   * not an accident, it is hole 13: an island green is *deliberately* a putting surface ringed by
   * water, and the green has to win for it to exist at all.
   *
   * The corridor's visual edge sits where the blend crosses halfway -- smoothstep01 is 0.5 at
   * its midpoint, so `tCorridor < 0.5` is the same line the physics is already half-way across.
   * One source for the edge rather than a separate visual constant to drift.
   */
  function surfaceAt(worldX: number, worldZ: number): SurfaceId {
    if (pointInEllipse(worldX, worldZ, spec.green)) return SurfaceId.Green;
    if (isWaterAt(spec, worldX, worldZ)) return SurfaceId.Water;
    if (isSand(worldX, worldZ)) return SurfaceId.Sand;
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

  /**
   * Deliberately re-derives sand and water through `surfaceAt` rather than sampling the noise
   * again: `surfaceAt`'s priority order (water beats green beats sand beats the corridor) is the
   * classification, and a second copy of that order here is exactly the drift this function was
   * added to prevent.
   */
  function weightsAt(worldX: number, worldZ: number, out: SurfaceWeights): void {
    const id = surfaceAt(worldX, worldZ);
    out.sand = id === SurfaceId.Sand ? 1 : 0;
    out.water = id === SurfaceId.Water ? 1 : 0;
    out.green = greenWeight(worldX, worldZ);
    out.corridor = corridorWeight(worldX, worldZ);
  }

  return { surfaceAt, tuningAt, weightsAt };
}
