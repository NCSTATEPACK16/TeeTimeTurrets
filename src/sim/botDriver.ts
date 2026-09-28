import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import type { Cart } from "./entities/Cart";
import type { BallPool } from "./entities/BallPool";
import type { Bucket } from "./entities/Pickup";
import { lineClear, planRoute } from "./navGraph";
import type { NavGraph, NavRoute } from "./navGraph";
import { clampToZone, zoneSignedDistance } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import { BOT_ENGAGE_RANGE, NO_TARGET, computeBotIntent, pickTarget } from "./bot";
import type { BotMind, BotTarget } from "./bot";
import { FIXED_DT } from "./frame";
import type { CartRig } from "./rigs";

/** Within this range and in a clear line, a bot drives straight at its target without a route. */
const NAV_DIRECT_M = 80;
/** Seconds between a bot's replans. */
const NAV_REPLAN_S = 1;
/**
 * A waypoint this close counts as reached. Wider than `BOT_STANDOFF`, or a bot would hold station
 * at each waypoint as though it were the enemy.
 */
const NAV_WAYPOINT_REACH_M = 22;

/** Neutral intent for callers that step without driving. Frozen: nothing ever writes to it. */
export const IDLE_INTENT: PlayerIntent = Object.freeze(neutralIntent());

/**
 * What drives the bots each tick: who each one fights, the ammo it heads for when empty, and the
 * route it follows across the zone to reach either. The per-bot memory lives on the rig
 * (`mind`, `route`, `targetIndex`); this holds what they share and one reused target.
 */
export class BotDriver {
  /** The target handed to `computeBotIntent`, reused per the no-allocation rule. */
  private readonly botTarget = { x: 0, z: 0, dead: false };

  constructor(
    /** Where bots can drive, on a ground with a zone. See navGraph.ts. */
    private readonly nav: NavGraph | null,
    private readonly zone: ArenaZone | null,
    private readonly buckets: readonly Bucket[],
  ) {}

  /**
   * The player's rig gets the player's intent; a bot's gets whatever `sim/bot.ts` decides. `rigs`
   * and `carts` are the same carts in rig order; `pool` is the live ball pool, which a rematch
   * rebuilds, so it is passed rather than held.
   */
  intentFor(
    rig: CartRig,
    playerIntent: PlayerIntent,
    rigs: readonly CartRig[],
    carts: readonly Cart[],
    pool: BallPool,
  ): PlayerIntent {
    if (rig.random === null) return playerIntent;
    // Unreachable by construction (addCartRig always pairs a non-null random with a non-null
    // intentScratch) -- but a bot with no scratch must idle, not mirror the player's controls.
    if (rig.intentScratch === null) return IDLE_INTENT;
    // A dead cart's intent is never read by stepRig, so computing one here would only spend the
    // bot's RNG stream on a throwaway draw and make the draw count depend on death timing.
    if (rig.cart.dead) return IDLE_INTENT;
    rig.targetIndex = pickTarget(rig.index, rig.targetIndex, carts);
    if (rig.mind !== null) this.findAmmoFor(rig.cart, rig.mind, pool);
    const target = this.botTargetScratch(rig.targetIndex, rigs);
    if (rig.route !== null) this.steerByRoute(rig.cart, rig.route, target);
    computeBotIntent(
      rig.cart,
      target,
      FIXED_DT,
      rig.random,
      rig.intentScratch,
      rig.mind,
    );
    return rig.intentScratch;
  }

  /**
   * Swaps a far or hidden target for the next waypoint on a planned route to it, so a bot drives
   * round a pond or a bank instead of into it. Close and in a clear line, the bot goes straight at
   * its target -- and always does within fighting range, where it aims at what it drives toward.
   * Replans at most once a second.
   */
  private steerByRoute(cart: Cart, route: NavRoute, target: { x: number; z: number; dead: boolean }): void {
    const nav = this.nav;
    if (nav === null || target.dead) return;
    const p = cart.position;
    const distance = Math.hypot(target.x - p.x, target.z - p.z);
    if (distance <= BOT_ENGAGE_RANGE || (distance <= NAV_DIRECT_M && lineClear(nav, p.x, p.z, target.x, target.z))) {
      route.count = 0;
      route.replanIn = 0;
      return;
    }
    route.replanIn -= FIXED_DT;
    if (route.replanIn <= 0) {
      route.count = planRoute(nav, p.x, p.z, target.x, target.z, route.points);
      route.next = 0;
      route.replanIn = NAV_REPLAN_S;
    }
    if (route.count === 0) return;
    // On to the next waypoint once this one is within reach and the next is in a clear line --
    // not before, or the bot cuts the corner the waypoint was there to take it round. The last
    // waypoint is the target itself, which moves, so the live target stands in for it.
    const points = route.points;
    while (
      route.next < route.count - 1 &&
      Math.hypot(points[route.next * 2]! - p.x, points[route.next * 2 + 1]! - p.z) < NAV_WAYPOINT_REACH_M &&
      lineClear(nav, p.x, p.z, points[route.next * 2 + 2]!, points[route.next * 2 + 3]!)
    ) {
      route.next++;
    }
    if (route.next >= route.count - 1) return;
    const wx = points[route.next * 2]!;
    const wz = points[route.next * 2 + 1]!;
    const toWaypoint = Math.hypot(wx - p.x, wz - p.z);
    if (toWaypoint >= NAV_WAYPOINT_REACH_M) {
      target.x = wx;
      target.z = wz;
      return;
    }
    // Close to a corner that cannot be cut yet: aim through it, so the bot drives on round it
    // rather than holding station at it as though it were the enemy.
    const scale = toWaypoint > 1e-6 ? NAV_WAYPOINT_REACH_M / toWaypoint : 0;
    target.x = p.x + (wx - p.x) * scale;
    target.z = p.z + (wz - p.z) * scale;
  }

  /**
   * Writes the nearest ammo a cart could collect right now into `mind`: a bucket off cooldown or a
   * landed ball, whoever fired it -- the same two things `stepRig` refills from. Only while the
   * magazine is empty, since that is the only time the bot reads it. Loops the pool directly rather
   * than through `ballsNear`, which builds an array per call. Rapier's `translation()` still hands
   * back a fresh vector per landed ball; that is the pool's own per-tick cost too, and Stage 3's.
   */
  private findAmmoFor(cart: Cart, mind: BotMind, pool: BallPool): void {
    mind.hasAmmoTarget = false;
    if (cart.ammo > 0) return;
    const px = cart.position.x;
    const pz = cart.position.z;
    let best = Infinity;
    for (const bucket of this.buckets) {
      if (bucket.cooldownRemaining > 0) continue;
      if (this.zone !== null && zoneSignedDistance(this.zone, bucket.position.x, bucket.position.z) > 0) continue;
      const d = Math.hypot(bucket.position.x - px, bucket.position.z - pz);
      if (d < best) {
        best = d;
        mind.ammoX = bucket.position.x;
        mind.ammoZ = bucket.position.z;
      }
    }
    for (const ball of pool.all) {
      if (ball.state !== "landed") continue;
      const t = ball.body.translation();
      if (this.zone !== null && zoneSignedDistance(this.zone, t.x, t.z) > 0) continue;
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < best) {
        best = d;
        mind.ammoX = t.x;
        mind.ammoZ = t.z;
      }
    }
    mind.hasAmmoTarget = best < Infinity;
  }

  /**
   * The enemy a bot is fighting, written into one reused object per the no-allocation rule; a bot
   * never sees its target's `Cart` itself. With no living enemy it reads as a dead target, which
   * the bot idles against.
   */
  private botTargetScratch(targetIndex: number, rigs: readonly CartRig[]): BotTarget {
    const target = targetIndex === NO_TARGET ? null : rigs[targetIndex]!.cart;
    this.botTarget.x = target?.position.x ?? 0;
    this.botTarget.z = target?.position.z ?? 0;
    this.botTarget.dead = target === null || target.dead;
    // A bot never chases out of the zone: an enemy past the stakes is hunted from the edge.
    if (this.zone !== null) clampToZone(this.zone, this.botTarget.x, this.botTarget.z, 0, this.botTarget);
    return this.botTarget;
  }
}
