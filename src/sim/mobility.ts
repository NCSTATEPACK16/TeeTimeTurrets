import {
  GRAVITY_MPS2,
  TRACKED_GRAVITY_SHARE,
  engineDriveAcceleration,
  trackGripCoefficient,
} from "../vendor/cot/terrainMobility";
import type { TerrainMobilitySpec } from "../vendor/cot/terrainMobility";
import type { TireTuning } from "./entities/Cart";
import { SurfaceId } from "./surfaceId";

/**
 * What the ground does to a cart: how hard it drags (resistance), how well the tyres hold on it
 * (grip), and from those two the cart's speed scale and the steepest grade it can climb.
 *
 * A thin wrapper over the vendored Claude of Tanks `terrainMobility.ts` (MIT; see `NOTICE`). That
 * module's rule is the one this project wants: no fleet-wide climb angle, but uphill authority bounded
 * by both the engine's tractive acceleration and the running gear's grip on the current ground. Its
 * functions take a per-vehicle spec keyed by ground type; here there is one vehicle, a cart, and its
 * tyres change the spec.
 *
 * **Resistance is the one number per surface**, and everything else derives from it:
 * - speed scale is `1 / resistance` (`surfaceSpeedScale`), which is what `surfaces.ts`'s
 *   `cartSpeedScale` column is built from, so the blended value the cart reads per tick comes from
 *   here;
 * - grip is the vendored `trackGripCoefficient` of that resistance and the tyre's own grip;
 * - the climb limit is where the vendored uphill margin reaches zero (`maxClimbRad`).
 *
 * The tick only ever sees a *blended* `cartSpeedScale` (smoothstepped across the mown edges), not a
 * `SurfaceId`, so it recovers resistance as `1 / cartSpeedScale`. At a pure surface that is the
 * table value exactly; across an edge it is a smooth value between the two.
 *
 * DOM-free and allocation-free: the tick calls `maxClimbRad` for every cart.
 */

export interface SurfaceMobility {
  /** Drag multiplier against the fairway's 1. Speed scales by its inverse. */
  readonly resistance: number;
}

/**
 * Starting values for playtesting. Rough at 1.4 keeps the cart near the 0.72 speed it has always had
 * off the fairway (now 0.714); sand halves it; water is a hazard, and only the speed matters there.
 */
export const SURFACE_MOBILITY: Readonly<Record<SurfaceId, SurfaceMobility>> = {
  [SurfaceId.Green]: { resistance: 1.0 },
  [SurfaceId.Fairway]: { resistance: 1.0 },
  [SurfaceId.Rough]: { resistance: 1.4 },
  [SurfaceId.Sand]: { resistance: 2.0 },
  [SurfaceId.Water]: { resistance: 3.3 },
  // Planks: no drag on a cart at all.
  [SurfaceId.Bridge]: { resistance: 1.0 },
};

/** Speed multiplier for a surface of this resistance, before the tyre. */
export function surfaceSpeedScale(resistance: number): number {
  return 1 / resistance;
}

/** Inverse of `surfaceSpeedScale`, for the blended per-tick value. Floored so 0 cannot divide. */
export function resistanceFromSpeedScale(cartSpeedScale: number): number {
  return 1 / Math.max(0.05, cartSpeedScale);
}

/**
 * The resistance this tyre actually feels. A tyre does not change the ground, it changes how much
 * of the ground's drag reaches the cart: `offRoadPenalty` scales the excess over the fairway's 1, so
 * on a fairway every tyre feels 1 and knobbies feel 40% of a bunker's excess.
 */
export function tireResistance(tire: TireTuning, resistance: number): number {
  return 1 + (resistance - 1) * tire.offRoadPenalty;
}

/** Top-speed multiplier for this tyre on ground of this blended speed scale. */
export function cartSpeedScale(tire: TireTuning, surfaceScale: number, minScale: number): number {
  const felt = tireResistance(tire, resistanceFromSpeedScale(surfaceScale));
  return tire.topSpeedScale * Math.max(minScale, surfaceSpeedScale(felt));
}

/**
 * The cart as a vendored mobility spec, reused rather than rebuilt per call. `terrainResistance`
 * holds a single `medium` entry that each call overwrites with the resistance this tyre feels.
 *
 * `weightTons` is a nominal 0.5 and `enginePowerHp` is set per call so that the vendored engine
 * acceleration on a resistance-1 surface equals the cart's own `CART_TUNING.accel` times tyre grip
 * -- the same drive `Cart.stepDrive` applies. One number for acceleration, not two.
 */
const SPEC = {
  terrainResistance: { medium: 1 } as Record<string, number>,
  enginePowerHp: 0,
  weightTons: 0.5,
  trackTraction: 1,
};
const SPEC_VIEW: TerrainMobilitySpec = SPEC;
/** The vendored module's acceleration per horsepower-per-tonne, recovered once. */
const ACCEL_PER_HPT = engineDriveAcceleration({ enginePowerHp: 1, weightTons: 1 });

function fillSpec(tire: TireTuning, surfaceScale: number, accel: number): void {
  SPEC.terrainResistance.medium = tireResistance(tire, resistanceFromSpeedScale(surfaceScale));
  SPEC.enginePowerHp = (accel * tire.grip * SPEC.weightTons) / ACCEL_PER_HPT;
  SPEC.trackTraction = tire.grip;
}

/** Longitudinal grip coefficient for this tyre on ground of this blended speed scale. */
export function cartGrip(tire: TireTuning, surfaceScale: number): number {
  fillSpec(tire, surfaceScale, 0);
  return trackGripCoefficient(SPEC_VIEW, "medium");
}

/**
 * The steepest grade this tyre can climb on this ground, radians: where the vendored
 * `uphillDriveMargin` reaches zero, solved in closed form.
 *
 * The margin compares the gravity the drive must beat, `TRACKED_GRAVITY_SHARE * g * sin(pitch)`, with
 * the force available, `min(engine, grip * g * cos(pitch))`. The grip side is equal at
 * `tan(pitch) = grip / share`; the engine side at `sin(pitch) = engine / (share * g)`. The lower of the
 * two is the limit. With the cart's acceleration the engine side never binds on any surface here
 * (it would need resistance above 5), so in practice this is grip, but both are honoured.
 *
 * `uphillDriveMargin` itself is not called because it answers "can I climb this grade?" and the KCC
 * wants "what is the steepest?" -- `mobility.test.ts` holds the two together on either side of the
 * answer.
 */
export function maxClimbRad(tire: TireTuning, surfaceScale: number, accel: number): number {
  fillSpec(tire, surfaceScale, accel);
  const grip = trackGripCoefficient(SPEC_VIEW, "medium");
  const engine = engineDriveAcceleration(SPEC_VIEW, "medium");
  const byGrip = Math.atan(grip / TRACKED_GRAVITY_SHARE);
  const byEngine = Math.asin(Math.min(1, engine / (TRACKED_GRAVITY_SHARE * GRAVITY_MPS2)));
  return Math.min(byGrip, byEngine);
}
