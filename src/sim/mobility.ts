import { DRIVE_ACCEL_PER_HPT, uphillDriveMargin } from "../vendor/cot/terrainMobility";
import type { TerrainMobilitySpec } from "../vendor/cot/terrainMobility";
import { CART_TUNING, TIRE_TUNING } from "./entities/Cart";
import type { TireType } from "./entities/Cart";
import type { SurfaceTuning } from "./surfaces";

/**
 * How steep a grade a cart can drive up, from the ground under it and the tyres on it.
 *
 * The rule is `src/vendor/cot/terrainMobility.ts`'s: the climb is bounded by the engine's
 * acceleration and by grip, and grip falls as the ground's resistance rises. This module only says
 * what a golf cart's numbers are:
 *
 * - **Resistance** is the surface's speed penalty read the other way round, `1 / cartSpeedScale`,
 *   with the tyre's `offRoadPenalty` scaling the part above 1. One table (`SURFACES`) says how much
 *   a surface slows a cart, and the climb follows from it, so the two cannot drift apart.
 * - **Traction** is the tyre's `grip`.
 * - **Engine** acceleration is `CART_TUNING.accel` scaled by grip, as `Cart.stepDrive` spends it.
 *
 * `world.ts` gives the character controller this angle for each cart every tick, in place of one
 * fixed angle for every cart on every surface. Bot navigation reads the same function, so a route
 * the planner accepts is one a cart can drive.
 *
 * Allocation-free: the vendor functions take a spec object, and this module reuses one.
 */

const GROUND = "ground";
const resistanceTable: Record<string, number> = { [GROUND]: 1 };
const spec: TerrainMobilitySpec = {
  terrainResistance: resistanceTable,
  enginePowerHp: 0,
  weightTons: 1,
  trackTraction: 1,
};

/** Bisection steps for the steepest drivable pitch: 2^-24 of a right angle is far below a degree. */
const CLIMB_STEPS = 24;

/** Ground resistance for this surface blend and tyre; 1 is firm fairway. */
export function resistanceOf(surface: SurfaceTuning, tire: TireType): number {
  const base = 1 / Math.max(0.05, surface.cartSpeedScale);
  return 1 + (base - 1) * TIRE_TUNING[tire].offRoadPenalty;
}

/** The steepest uphill pitch, radians, at which open throttle still makes progress. */
export function maxClimbRad(surface: SurfaceTuning, tire: TireType): number {
  const grip = TIRE_TUNING[tire].grip;
  resistanceTable[GROUND] = resistanceOf(surface, tire);
  spec.enginePowerHp = (CART_TUNING.accel * grip) / DRIVE_ACCEL_PER_HPT;
  spec.trackTraction = grip;

  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < CLIMB_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (uphillDriveMargin(spec, GROUND, mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
