/**
 * Death and coming back: `killCart` (the stroke, the kill feed and the mortar streak), the
 * respawn timer, and where a cart starts and returns.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { Cart, RESPAWN_DELAY_S } from "./entities/Cart";
import { MORTAR_STREAK } from "./mortar";
import { NO_KILLER, SPAWN_PROTECTION_S, teamOf } from "./matchConfig";
import { openingSpawn, padSpawn, respawnPoint } from "./spawn";
import type { SpawnPoint } from "./spawn";
import { NO_RIG } from "./events";
import { FIXED_DT } from "./tickConstants";
import type { Sim } from "./world";
import type { CartRig } from "./rigs";
import { placeRig, cartsOf } from "./rigs";

/**
 * Death: the cart is out of the world for `RESPAWN_DELAY_S` and comes back at a spawn point.
 * Guarded on `dead` so two lethal contacts in one tick do not restart the timer. The death is
 * the stroke: `Match.scoreKill` charges it to the victim's team.
 */
export function killCart(sim: Sim, cart: Cart, victim: number, killer: number): void {
  if (cart.dead) return;
  cart.dead = true;
  cart.respawnTimer = RESPAWN_DELAY_S;
  sim.match.scoreKill(killer, victim);
  sim.tally.killed(killer, victim, sim.tickCount);
  const p = cart.position;
  sim.events.push("kill", sim.tickCount, killer, victim, 0, p.x, p.y, p.z);
  // The streak ends with the death, however it came. An enemy kill -- the rule `scoreKill` pays a
  // point by -- adds to the killer's, and every third earns a mortar if none is held.
  cart.killStreak = 0;
  if (killer === NO_KILLER || killer < 0 || killer >= sim.rigs.length || teamOf(killer) === teamOf(victim)) return;
  const by = sim.rigs[killer]!.cart;
  by.killStreak += 1;
  if (by.killStreak % MORTAR_STREAK === 0 && by.mortars === 0) {
    by.mortars = 1;
    const at = by.position;
    sim.events.push("mortarEarned", sim.tickCount, killer, NO_RIG, by.killStreak, at.x, at.y, at.z);
  }
}

/**
 * Counts one cart's respawn delay down and puts it back on a tee when it expires. Intent is not
 * read at all while dead, so ammo, reload and position are frozen for the duration.
 */
export function stepRespawn(sim: Sim, rig: CartRig): void {
  rig.cart.respawnTimer -= FIXED_DT;
  if (rig.cart.respawnTimer > 0) return;
  placeRig(rig, respawnPointFor(sim, rig.index));
  rig.cart.revive();
  const p = rig.cart.position;
  sim.events.push("respawn", sim.tickCount, rig.index, NO_RIG, 0, p.x, p.y, p.z);
  // After `revive`, which clears it: protection is a property of respawning, granted here and
  // nowhere else, so `reset` starting a fresh match does not start it behind a shield.
  rig.cart.protectedFor = SPAWN_PROTECTION_S;
}

/** Where rig `index` starts a match: its team's pad by the clubhouse, or its dealt tee. */
export function openingPoint(sim: Sim, index: number): SpawnPoint {
  return sim.teamPads === null ? openingSpawn(sim.spawnSet, index) : padSpawn(sim.teamPads, index);
}

/**
 * Where rig `index` comes back: its own slot on its team's pad. With no clubhouse, a random tee
 * avoiding whoever is alive and standing on one -- `index` is passed because the cart's own body
 * is still lying where it died, and counting it would make its nearest tee unavailable to it.
 */
export function respawnPointFor(sim: Sim, index: number): SpawnPoint {
  if (sim.teamPads !== null) return padSpawn(sim.teamPads, index);
  return respawnPoint(sim.spawnSet, sim.spawnRandom, cartsOf(sim), index);
}
