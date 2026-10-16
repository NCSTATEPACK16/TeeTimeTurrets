import { STROKE_DAMAGE } from "./combat";
import { applyDamage } from "./health";
import { outOfBoundsDrain, zoneSignedDistance } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import { SurfaceId } from "./surfaces";
import type { Surfaces } from "./surfaces";
import { NO_TARGET_RIG } from "./events";
import type { SimEventLog } from "./events";
import { FIXED_DT } from "./frame";
import type { Cart } from "./entities/Cart";
import type { CartRig } from "./rigs";

/**
 * A death the ground caused rather than a shooter: `victim` is the rig index. The caller scores it
 * as a stroke with no killer.
 */
export type HazardDeath = (cart: Cart, victim: number) => void;

/**
 * A cart in the water loses a point of health and is dropped back where it was last on dry land.
 * Edge-triggered on `wasInWater`, so a cart nosing into a pond pays once rather than once per tick.
 * A drowning that empties the bar is a death nobody caused: a stroke, and a point for nobody.
 */
export function checkCartWater(rig: CartRig, surfaces: Surfaces, events: SimEventLog, die: HazardDeath): void {
  const cart = rig.cart;
  const p = cart.position;
  const inWater = surfaces.surfaceAt(p.x, p.z) === SurfaceId.Water;

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
  events.push("splash", NO_TARGET_RIG, rig.index, p.x, p.y, p.z, 0, null);

  if (applyDamage(cart.health, STROKE_DAMAGE)) die(cart, rig.index);

  const safe = cart.lastSafePosition;
  p.x = safe.x;
  p.y = safe.y;
  p.z = safe.z;
  cart.speed = 0;
  rig.fallSpeed = 0;
  rig.body.setTranslation(p, true);
}

/**
 * Outside the zone a cart is warned at once and drains a point every two seconds; a drain that
 * empties the bar is a death nobody caused, like a drowning.
 */
export function checkZone(rig: CartRig, zone: ArenaZone | null, die: HazardDeath): void {
  const cart = rig.cart;
  if (zone === null || cart.dead) return;
  const p = cart.position;
  if (zoneSignedDistance(zone, p.x, p.z) <= 0) {
    cart.outOfBoundsFor = 0;
    return;
  }
  const before = cart.outOfBoundsFor;
  cart.outOfBoundsFor += FIXED_DT;
  const drain = outOfBoundsDrain(before, cart.outOfBoundsFor);
  if (drain > 0 && applyDamage(cart.health, drain)) die(cart, rig.index);
}
