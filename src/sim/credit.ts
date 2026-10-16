import { RESPAWN_DELAY_S } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { Match } from "./match";
import { NO_KILLER, teamOf } from "./matchConfig";
import { ASSIST_WINDOW_S, createTally } from "./scoring";
import type { MatchTally } from "./scoring";
import type { Stats } from "./stats";
import { NO_TARGET_RIG } from "./events";
import type { SimEventLog } from "./events";

/**
 * Who gets what for a hit or a kill: the scoreboard, the event log, and the player's own accuracy
 * (`stats`) and match tally (`tally`), including the assists it remembers hits for.
 */
export class MatchCredit {
  /** When the player last hit each rig, by rig index, for assists. */
  private readonly playerHitAt: number[] = [];

  constructor(
    private readonly match: Match,
    private readonly events: SimEventLog,
    private readonly stats: Stats,
    private readonly tally: MatchTally,
  ) {}

  /** A new match: the tally and the assist memory start again. `stats` is the session's. */
  reset(): void {
    Object.assign(this.tally, createTally());
    this.playerHitAt.length = 0;
  }

  /**
   * Death: the cart is out of the world for `RESPAWN_DELAY_S` and comes back at a spawn point.
   * Guarded on `dead` so two lethal contacts in one tick do not restart the timer. The death is
   * the stroke: `Match.scoreKill` charges it to the victim's team. `now` is the sim clock.
   */
  kill(cart: Cart, victim: number, killer: number, now: number): void {
    if (cart.dead) return;
    cart.dead = true;
    cart.respawnTimer = RESPAWN_DELAY_S;
    this.match.scoreKill(killer, victim);
    const playerTeam = teamOf(0);
    if (teamOf(victim) !== playerTeam) {
      if (killer === 0) this.tally.kills += 1;
      else if (
        killer !== NO_KILLER &&
        teamOf(killer) === playerTeam &&
        now - (this.playerHitAt[victim] ?? -Infinity) <= ASSIST_WINDOW_S
      ) {
        this.tally.assists += 1;
      }
    }
    const p = cart.position;
    this.events.push("kill", killer, victim, p.x, p.y, p.z, 0, null);
    this.events.push("stroke", NO_TARGET_RIG, victim, p.x, p.y, p.z, this.match.teamStrokes(teamOf(victim)), null);
  }

  /**
   * A fired ball connected: `shooter` fired it, it hit `victim` and took `damage` off it. Every hit
   * is an event; only rig 0's may write `stats`, which is the **player's** -- the accuracy the
   * results screen reports.
   */
  hit(shooter: number, victim: number, damage: number, x: number, y: number, z: number, now: number): void {
    this.events.push("hit", shooter, victim, x, y, z, damage, null);
    if (shooter === 0) {
      this.stats.directHits += 1;
      if (teamOf(victim) !== teamOf(0)) {
        this.tally.damage += damage;
        this.playerHitAt[victim] = now;
      }
    }
  }
}
