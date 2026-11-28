/**
 * The two hazards a cart can drive into: water (a stroke and a drop back on dry land) and the
 * zone (a warning, then a drain).
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { STROKE_DAMAGE } from "./combat";
import { applyDamage } from "./health";
import { SurfaceId } from "./surfaces";
import { ZONE_DRAIN_HP, ZONE_DRAIN_INTERVAL_S } from "./arenaZone";
import { NO_KILLER } from "./matchConfig";
import { NO_RIG } from "./events";
import { FIXED_DT } from "./tickConstants";
import type { Sim } from "./world";
import type { CartRig } from "./rigs";
import { killCart } from "./respawn";

/**
 * A cart in the water loses a point of health and is dropped back where it was last on dry land.
 * Edge-triggered on `wasInWater`, so a cart nosing into a pond pays once rather than once per tick.
 * A drowning that empties the bar is a death nobody caused: a stroke, and a point for nobody.
 */
export function checkCartWater(sim: Sim, rig: CartRig): void {
  const cart = rig.cart;
  const p = cart.position;
  const inWater = sim.surfaces.surfaceAt(p.x, p.z) === SurfaceId.Water;

  if (!inWater) {
    cart.wasInWater = false;
    // Recorded every dry tick: wherever the cart is now is somewhere it can be put back down.
    cart.lastSafePosition.x = p.x;
    cart.lastSafePosition.y = p.y;
    cart.lastSafePosition.z = p.z;
    return;
  }

  if (cart.wasInWater) return;
  cart.wasInWater = true;
  sim.events.push("splash", sim.tickCount, rig.index, NO_RIG, 0, p.x, p.y, p.z);

  if (applyDamage(cart.health, STROKE_DAMAGE)) killCart(sim, cart, rig.index, NO_KILLER);

  const safe = cart.lastSafePosition;
  p.x = safe.x;
  p.y = safe.y;
  p.z = safe.z;
  cart.speed = 0;
  rig.fallSpeed = 0;
  rig.body.setTranslation(p, true);
}

/**
 * Outside the zone a cart is warned at once (`outOfZoneS > 0`), then loses `ZONE_DRAIN_HP` every
 * `ZONE_DRAIN_INTERVAL_S` until it comes back. Like drowning, a drain that empties the bar is a
 * death nobody caused: a stroke, and a point for nobody. Back inside, the clock resets.
 */
export function checkCartZone(sim: Sim, rig: CartRig): void {
  if (sim.zone === null) return;
  const cart = rig.cart;
  if (sim.zone.contains(cart.position.x, cart.position.z)) {
    cart.outOfZoneS = 0;
    return;
  }
  if (cart.outOfZoneS === 0) cart.zoneDrainIn = ZONE_DRAIN_INTERVAL_S;
  cart.outOfZoneS += FIXED_DT;
  cart.zoneDrainIn -= FIXED_DT;
  if (cart.zoneDrainIn > 1e-9) return;
  cart.zoneDrainIn += ZONE_DRAIN_INTERVAL_S;
  if (applyDamage(cart.health, ZONE_DRAIN_HP)) killCart(sim, cart, rig.index, NO_KILLER);
}
