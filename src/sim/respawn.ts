import { SPAWN_CHANNEL, SPAWN_PROTECTION_S } from "./matchConfig";
import { createSpawnSet, createTeamPads, openingSpawn, padSpawn, respawnPoint } from "./spawn";
import type { SpawnPoint } from "./spawn";
import type { ArenaGround } from "./arena";
import type { Cart } from "./entities/Cart";
import { hashChannel, mulberry32 } from "./rng";
import { NO_TARGET_RIG } from "./events";
import type { SimEventLog } from "./events";
import { FIXED_DT } from "./frame";
import { placeRig } from "./rigs";
import type { CartRig } from "./rigs";

/**
 * Where carts start a match and where they come back: the clubhouse team pads on a ground that has
 * a clubhouse, or the dealt tees on one that does not, with the seeded stream random respawns draw.
 */
export class SpawnPlan {
  /** One tee per spawn hole, in the course frame. */
  private readonly spawnSet: SpawnPoint[];
  /** The clubhouse team pads, `[team][slot]`, or null on a ground with no clubhouse. */
  private readonly teamPads: SpawnPoint[][] | null;
  /**
   * The stream respawn tees are drawn from. Seeded from the ground rather than the clock, per the
   * `AGENTS.md` no-`Math.random`-in-the-sim rule, and re-seeded by `reset()` so "play again" is a
   * genuine rerun.
   */
  private random: () => number;

  constructor(
    ground: ArenaGround,
    private readonly seed: number,
  ) {
    this.spawnSet = createSpawnSet(ground.holes, (x, z) => ground.playfield.heightAt(x, z));
    this.teamPads =
      ground.clubhouse === null ? null : createTeamPads(ground.clubhouse, (x, z) => ground.playfield.heightAt(x, z));
    this.random = mulberry32(hashChannel(seed, SPAWN_CHANNEL));
  }

  /** The respawn stream back at its start, for a rematch. */
  reset(): void {
    this.random = mulberry32(hashChannel(this.seed, SPAWN_CHANNEL));
  }

  /** Where rig `index` starts a match: its team's pad by the clubhouse, or its dealt tee. */
  openingPoint(index: number): SpawnPoint {
    return this.teamPads === null ? openingSpawn(this.spawnSet, index) : padSpawn(this.teamPads, index);
  }

  /**
   * Where rig `index` comes back: its own slot on its team's pad. With no clubhouse, a random tee
   * avoiding whoever is alive and standing on one -- `index` is passed because the cart's own body
   * is still lying where it died, and counting it would make its nearest tee unavailable to it.
   */
  respawnPointFor(index: number, carts: readonly Cart[]): SpawnPoint {
    if (this.teamPads !== null) return padSpawn(this.teamPads, index);
    return respawnPoint(this.spawnSet, this.random, carts, index);
  }
}

/**
 * Counts one cart's respawn delay down and puts it back on a tee when it expires. Intent is not
 * read at all while dead, so ammo, reload and position are frozen for the duration.
 */
export function stepRespawn(rig: CartRig, plan: SpawnPlan, carts: readonly Cart[], events: SimEventLog): void {
  rig.cart.respawnTimer -= FIXED_DT;
  if (rig.cart.respawnTimer > 0) return;
  placeRig(rig, plan.respawnPointFor(rig.index, carts));
  rig.cart.revive();
  const p = rig.cart.position;
  events.push("respawn", NO_TARGET_RIG, rig.index, p.x, p.y, p.z, 0, null);
  // After `revive`, which clears it: protection is a property of respawning, granted here and
  // nowhere else, so `reset` starting a fresh match does not start it behind a shield.
  rig.cart.protectedFor = SPAWN_PROTECTION_S;
}
