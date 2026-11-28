/**
 * Each bot's intent, per tick: its target and the point it drives at, capture-flag runs, ammo
 * and hot-dog seeking, and routing over the navigation graph, handed to `computeBotIntent`.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { Cart } from "./entities/Cart";
import { nearestCharged } from "./pickups";
import { clearOfObstacles } from "./lineOfSight";
import { MORTAR_MAX_RANGE_M, MORTAR_SPREAD_M } from "./mortar";
import {
  BOT_FIRE_RANGE,
  BOT_FLAG_DIVERT_M,
  BOT_HEAL_FRACTION,
  BOT_HEAL_RANGE_M,
  NO_TARGET,
  computeBotIntent,
  pickTarget,
  shouldCallMortar,
} from "./bot";
import type { BotMind, BotTarget } from "./bot";
import { TEAM_COUNT, teamOf } from "./matchConfig";
import { FIXED_DT } from "./tickConstants";
import type { Sim } from "./world";
import type { CartRig } from "./rigs";
import { cartsOf } from "./rigs";

/**
 * Height above a cart's position a sight line is taken from and to, for bots: the hull's middle,
 * about where a putter ball flies. `clearOfObstacles` compares it against building tops.
 */
export const BOT_EYE_M = 1;

/** Neutral intent for callers that step without driving. Frozen: `Sim` never writes to it. */
export const IDLE_INTENT: PlayerIntent = Object.freeze(neutralIntent());

/** Metres. A goal this near and in direct sight is driven at straight, with no plan (Stage 6 spec, §3.2). */
export const ROUTE_DIRECT_M = 80;

/** Ticks between a bot's scheduled planning chances: once a second. */
export const ROUTE_PERIOD_TICKS = 60;

/** Bot `i` plans on tick `(i x stride) % period` of each second, so no two bots of seven share one. */
export const ROUTE_SLOT_STRIDE = 7;

/** Metres a goal may move before the route to it is planned again. */
export const ROUTE_GOAL_MOVED_M = 12;

/** Metres from a waypoint at which a bot moves on to the next (Q5). */
export const ROUTE_REACH_M = 6;

/** The player's rig gets the player's intent; a bot's gets whatever `sim/bot.ts` decides. */
export function intentFor(sim: Sim, rig: CartRig, playerIntent: PlayerIntent): PlayerIntent {
  if (rig.random === null) return playerIntent;
  // Unreachable by construction (addCartRig always pairs a non-null random with a non-null
  // intentScratch) -- but a bot with no scratch must idle, not mirror the player's controls.
  if (rig.intentScratch === null) return IDLE_INTENT;
  // A dead cart's intent is never read by stepRig, so computing one here would only spend the
  // bot's RNG stream on a throwaway draw and make the draw count depend on death timing.
  if (rig.cart.dead) {
    // A respawned bot plans from where it now stands, not from where it died.
    if (rig.mind !== null) rig.mind.replanNow = true;
    return IDLE_INTENT;
  }
  rig.targetIndex = pickTarget(rig.index, rig.targetIndex, cartsOf(sim));
  const target = botTargetScratch(sim, rig.cart, rig.targetIndex);
  // The same scratch `botTargetScratch` just wrote, through its writable type.
  flagDrive(sim, rig, sim.botTarget);
  if (rig.mind !== null) {
    findAmmoFor(sim, rig.cart, rig.mind);
    findHealFor(sim, rig.cart, rig.mind, target);
    routeSteer(sim, rig.index, rig.cart, rig.mind, target);
  }
  computeBotIntent(
    rig.cart,
    target,
    FIXED_DT,
    rig.random,
    rig.intentScratch,
    rig.mind,
  );
  if (rig.cart.mortars > 0) {
    rig.intentScratch.callMortar = shouldCallMortar(
      rig.cart,
      target,
      sideNear(sim, teamOf(rig.index), target.x, target.z, MORTAR_SPREAD_M),
      MORTAR_MAX_RANGE_M,
    );
  }
  return rig.intentScratch;
}

/**
 * Capture flags without routing (Stage 3.5c, spec §4). Each side's lowest-index bot -- rig 2 for
 * team 0, rig 1 for team 1 -- is its flag runner: it drives to the nearest flag its side does not
 * own, or, when its side owns all three, to the owned flag the most enemies are nearest.
 *
 * **It goes whether or not an enemy is close**, which is a change from the spec's "unless an
 * enemy is within `BOT_ENGAGE_RANGE`". The team pads are 50 m apart, so from the whistle there is
 * always an enemy inside 40 m of the clubhouse, and a runner that stopped to fight never left it
 * (measured: 99 m from the nearest flag after 30 s). It still aims and shoots whatever is in
 * range, on the way and on the flag; only where it drives changed. Every other bot keeps fighting, but
 * one whose target is dead or more than `BOT_FLAG_DIVERT_M` away takes the nearest flag its side
 * does not own on the way. Either way the bot holds on the flag (`holdAtDrive`). Straight lines,
 * as everything a bot drives is: Stage 6's routing replaces sim.
 */
export function flagDrive(sim: Sim, rig: CartRig, t: Sim["botTarget"]): void {
  t.holdAtDrive = false;
  const captures = sim.captures;
  if (captures.sites.length === 0) return;
  const team = teamOf(rig.index);
  const p = rig.cart.position;
  const away = t.dead ? Infinity : Math.hypot(t.x - p.x, t.z - p.z);
  const runner = rig.index >= 1 && rig.index <= TEAM_COUNT;
  let goal = -1;
  if (runner) {
    goal = nearestFlag(sim, team, p.x, p.z, false);
    if (goal < 0) goal = flagToDefend(sim, team);
  } else if (away > BOT_FLAG_DIVERT_M) {
    goal = nearestFlag(sim, team, p.x, p.z, false);
  }
  if (goal < 0) return;
  const site = captures.sites[goal]!;
  t.driveX = site.x;
  t.driveZ = site.z;
  t.holdAtDrive = true;
}

/**
 * Where a bot points its cart sim tick (Stage 6 spec, §3): at the next waypoint of a route over
 * the navigation graph, or, with the goal in direct sight inside `ROUTE_DIRECT_M`, nowhere special
 * (`hasSteer` false: it steers at the goal itself). The goal is what `computeBotIntent` is about to
 * drive at -- ammo, a hot dog, or the target's drive point -- chosen in the same order.
 *
 * Plans are rationed: at once after a respawn or a back-off (`replanNow`) or when there is no
 * route, and otherwise only on the bot's own tick of each second (`ROUTE_SLOT_STRIDE`), when its
 * goal has moved `ROUTE_GOAL_MOVED_M` from the one the route was planned to. Allocation-free.
 */
export function routeSteer(sim: Sim, index: number, cart: Cart, mind: BotMind, target: BotTarget): void {
  mind.hasSteer = false;
  const nav = sim.nav;
  if (nav === null || mind.unstickFor > 0) return;
  let gx: number;
  let gz: number;
  if (cart.ammo <= 0 && mind.hasAmmoTarget) {
    gx = mind.ammoX;
    gz = mind.ammoZ;
  } else if (mind.hasHealTarget) {
    gx = mind.healX;
    gz = mind.healZ;
  } else if (target.dead && target.holdAtDrive !== true) {
    return;
  } else {
    gx = target.driveX ?? target.x;
    gz = target.driveZ ?? target.z;
  }
  const px = cart.position.x;
  const pz = cart.position.z;
  if (Math.hypot(gx - px, gz - pz) <= ROUTE_DIRECT_M && nav.lineClear(px, pz, gx, gz)) {
    mind.routeOn = false;
    return;
  }
  const onSlot = sim.tickCount % ROUTE_PERIOD_TICKS === (index * ROUTE_SLOT_STRIDE) % ROUTE_PERIOD_TICKS;
  const moved = Math.hypot(gx - mind.routeGoalX, gz - mind.routeGoalZ) > ROUTE_GOAL_MOVED_M;
  if (mind.replanNow || (!mind.routeOn && onSlot) || (mind.routeOn && moved && onSlot) || (!mind.routeOn && moved)) {
    mind.replanNow = false;
    mind.routeGoalX = gx;
    mind.routeGoalZ = gz;
    mind.routeOn = nav.plan(px, pz, gx, gz, mind.route);
    mind.routeAt = 0;
  }
  if (!mind.routeOn) return;
  const route = mind.route;
  const last = route.count - 1;
  while (
    mind.routeAt < last &&
    Math.hypot(route.points[mind.routeAt * 2]! - px, route.points[mind.routeAt * 2 + 1]! - pz) < ROUTE_REACH_M
  ) {
    mind.routeAt++;
  }
  // One look ahead a tick: on to the waypoint after sim one when it is already in sight.
  if (mind.routeAt < last && nav.lineClear(px, pz, route.points[mind.routeAt * 2 + 2]!, route.points[mind.routeAt * 2 + 3]!)) {
    mind.routeAt++;
  }
  mind.hasSteer = true;
  mind.steerX = route.points[mind.routeAt * 2]!;
  mind.steerZ = route.points[mind.routeAt * 2 + 1]!;
  // The route's own end is where the goal was; steer at where it is now.
  if (mind.routeAt === last) {
    mind.steerX = gx;
    mind.steerZ = gz;
  }
}

/** The nearest flag `team` owns (`owned`) or does not, or -1 when there is none. */
export function nearestFlag(sim: Sim, team: number, x: number, z: number, owned: boolean): number {
  const captures = sim.captures;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < captures.sites.length; i++) {
    if ((captures.owner[i] === team) !== owned) continue;
    const site = captures.sites[i]!;
    const d = Math.hypot(site.x - x, site.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * With every flag its side's, the one most living enemies stand nearest -- the one they are
 * likeliest to go for. A tie goes to the lower index, and with no living enemy to the first.
 */
export function flagToDefend(sim: Sim, team: number): number {
  const captures = sim.captures;
  const counts = sim.flagCounts;
  counts.fill(0);
  for (let i = 0; i < sim.rigs.length; i++) {
    const cart = sim.rigs[i]!.cart;
    if (cart.dead || teamOf(i) === team) continue;
    const nearest = nearestFlag(sim, team, cart.position.x, cart.position.z, true);
    if (nearest >= 0) counts[nearest]! += 1;
  }
  let best = 0;
  for (let i = 1; i < captures.sites.length; i++) if (counts[i]! > counts[best]!) best = i;
  return best;
}

/** Whether a living cart of `team` stands within `radius` of a point. */
export function sideNear(sim: Sim, team: number, x: number, z: number, radius: number): boolean {
  for (let i = 0; i < sim.rigs.length; i++) {
    const cart = sim.rigs[i]!.cart;
    if (cart.dead || teamOf(i) !== team) continue;
    if (Math.hypot(cart.position.x - x, cart.position.z - z) <= radius) return true;
  }
  return false;
}

/**
 * Writes the nearest ammo a cart could collect right now into `mind`: a charged bucket or a
 * landed ball, whoever fired it -- the same two things `stepRig` refills from. Only while the
 * magazine is empty, since that is the only time the bot reads it. Reads the pool's cached
 * positions (`BallPool.sync`) rather than asking Rapier, which hands back a fresh object per ask.
 */
export function findAmmoFor(sim: Sim, cart: Cart, mind: BotMind): void {
  mind.hasAmmoTarget = false;
  if (cart.ammo > 0) return;
  const px = cart.position.x;
  const pz = cart.position.z;
  let best = Infinity;
  const bucket = sim.seekScratch;
  if (nearestCharged(sim.pickupStates, "bucket", sim.simTime, px, pz, Infinity, bucket)) {
    best = Math.hypot(bucket.x - px, bucket.z - pz);
    mind.ammoX = bucket.x;
    mind.ammoZ = bucket.z;
  }
  const balls = sim.ballPool.all;
  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i]!;
    if (ball.state !== "landed") continue;
    const x = ball.position[0]!;
    const z = ball.position[2]!;
    // A ball out of the zone is not worth the drain it would cost, and a bot only drives inside.
    if (sim.zone !== null && !sim.zone.contains(x, z)) continue;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      mind.ammoX = x;
      mind.ammoZ = z;
    }
  }
  mind.hasAmmoTarget = best < Infinity;
}

/**
 * Writes a hot dog into `mind` for a hurt bot to head for: at `BOT_HEAL_FRACTION` of its health
 * or below, a charged one within `BOT_HEAL_RANGE_M`, and only while its enemy is out of firing
 * range. A bot that broke off mid-fight to heal would read as cowardly and be easy to farm.
 */
export function findHealFor(sim: Sim, cart: Cart, mind: BotMind, target: BotTarget): void {
  mind.hasHealTarget = false;
  if (cart.health.hp > cart.health.max * BOT_HEAL_FRACTION) return;
  const px = cart.position.x;
  const pz = cart.position.z;
  if (!target.dead && Math.hypot(target.x - px, target.z - pz) <= BOT_FIRE_RANGE) return;
  const at = sim.seekScratch;
  if (!nearestCharged(sim.pickupStates, "hot_dog", sim.simTime, px, pz, BOT_HEAL_RANGE_M, at)) return;
  mind.hasHealTarget = true;
  mind.healX = at.x;
  mind.healZ = at.z;
}

/**
 * The enemy `self` is fighting, written into one reused object per the no-allocation rule; a bot
 * never sees its target's `Cart` itself. With no living enemy it reads as a dead target, which
 * the bot idles against. `hidden` is true when a building stands between them: the bot still
 * closes, but holds its fire rather than shooting a wall.
 */
export function botTargetScratch(sim: Sim, self: Cart, targetIndex: number): BotTarget {
  const target = targetIndex === NO_TARGET ? null : sim.rigs[targetIndex]!.cart;
  const t = sim.botTarget;
  t.x = target?.position.x ?? 0;
  t.z = target?.position.z ?? 0;
  // Drive at the target, or at the zone's edge nearest it when it is outside (#52).
  t.driveX = t.x;
  t.driveZ = t.z;
  if (sim.zone !== null && sim.zone.clampInside(t.x, t.z, sim.zoneScratch)) {
    t.driveX = sim.zoneScratch.x;
    t.driveZ = sim.zoneScratch.z;
  }
  t.dead = target === null || target.dead;
  t.hidden =
    target !== null &&
    !clearOfObstacles(
      sim.obstacles,
      self.position.x,
      self.position.y + BOT_EYE_M,
      self.position.z,
      target.position.x,
      target.position.y + BOT_EYE_M,
      target.position.z,
    );
  return t;
}
