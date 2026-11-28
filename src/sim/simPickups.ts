/**
 * The per-tick pickup driver: pickup sites (`pickups.ts` holds their rules) and loose balls.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { BUCKET_REFILL_AMMO } from "./entities/Cart";
import { HOT_DOG_HEAL, siteInReach, take } from "./pickups";
import { NO_RIG } from "./events";
import type { Sim } from "./world";
import type { CartRig } from "./rigs";

/**
 * How close a cart has to be to a landed ball to collect it. Ammo is the only thing a landed ball
 * is for, so driving over your own spent rounds is how a cart reloads between buckets. Pickup
 * sites have their own radius, `PICKUP_GRAB_RADIUS_M`.
 */
export const PICKUP_RANGE = 3.0;

/**
 * What one cart collects this tick, after it has moved: the pickup site it is on, if one is in
 * reach and charged, then every landed ball within `PICKUP_RANGE`.
 */
export function collectPickups(sim: Sim, rig: CartRig): void {
  const cart = rig.cart;
  const c = cart.position;
  // Rigs are stepped in order, and a take starts the site's cooldown at once, so two carts on
  // one site in one tick yield exactly one take: the lower rig index's.
  const site = siteInReach(sim.pickupStates, cart, sim.simTime);
  if (site >= 0) {
    const type = sim.pickupStates[site]!.site.type;
    take(sim.pickupStates, site, cart, sim.simTime);
    // A site, not a loose ball: driving over spent rounds is reloading, and at 15 points a ball
    // it would out-earn the kills (Stage 8 spec, Q10).
    sim.tally.pickedUp(rig.index);
    if (type === "drink") {
      sim.events.push("shieldGained", sim.tickCount, rig.index, NO_RIG, cart.shield, c.x, c.y, c.z);
    } else {
      const amount = type === "bucket" ? BUCKET_REFILL_AMMO : HOT_DOG_HEAL;
      sim.events.push("pickup", sim.tickCount, rig.index, NO_RIG, amount, c.x, c.y, c.z);
    }
  }
  const near = sim.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE, sim.nearScratch);
  for (let i = 0; i < near; i++) {
    cart.addAmmo(1);
    sim.ballPool.release(sim.nearScratch[i]!);
    sim.events.push("pickup", sim.tickCount, rig.index, NO_RIG, 1, c.x, c.y, c.z);
  }
}
