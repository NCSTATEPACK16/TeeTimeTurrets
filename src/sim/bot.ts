import { applyAimSpread } from "../physics/Ballistics";
import type { PlayerIntent } from "./intent";
import type { Cart } from "./entities/Cart";
import { teamOf } from "./matchConfig";
import { solveShot } from "./aimSolver";

/**
 * The AI opponent, as one pure function of exactly the state it needs: its own cart, and where
 * the thing it is fighting happens to be. Structural rather than a method on `Cart` or `Sim`,
 * the same way `hudState.ts`'s `HudSource` is -- it makes the whole behaviour testable with no
 * Rapier world and no `Sim` at all.
 *
 * DOM-free and Rapier-free like everything else in `src/sim/**`. Deliberately has no memory:
 * everything it needs to decide is already on the cart it is driving.
 */

/**
 * Metres. Outside this the bot drives at its target but does not aim or shoot.
 *
 * It used to idle out here instead, on the reasoning that closing would be pathfinding across the
 * course. That held while the arena was one generated hole and every cart was tens of metres from
 * the next. The authored eighteen-hole routing deals carts one to a hole: the closest two tees on
 * the whole course are 74 m apart, so under the old rule every bot in every match stood still from
 * the opening tick and arena combat did not happen at all.
 *
 * Closing is not pathfinding. It is the same straight-line drive the bot already did inside this
 * range -- no navigation, no obstacle avoidance, no memory -- so a bot can still be stopped by
 * water or a wood between it and its target. That is a real gap and it is deferred, not solved
 * here; what is fixed is that the bot now tries.
 */
export const BOT_ENGAGE_RANGE = 40;
/**
 * Metres. Inside this the bot stops closing and holds station.
 *
 * Bots fire the **putter**, which is a flat, fast pistol (`CLUB_STATS`): its ball is still at
 * cart height 40 m out (`putterPistol.test.ts`), so the standoff is a fighting distance, not the
 * one range a lobbed shot happens to come down at. It was 7 m when the putter was a 9 m/s lob.
 * Far enough that a bot is not parked on its target's bonnet, close enough that the 0.4 deg spread
 * still lands on a 1.8 m hull.
 */
export const BOT_STANDOFF = 15;
/**
 * Metres. The bot pulls the trigger only inside this. Aiming still begins at `BOT_ENGAGE_RANGE`,
 * so the turret is lined up before the target is in range. Short of the 40 m the pistol is held
 * to, so every trigger pull is a shot that can connect.
 */
export const BOT_FIRE_RANGE = 35;
/** Radians per second of turret slew. Bounded so the bot's aim is not instant and omniscient. */
export const BOT_AIM_RATE = 1.2;
/** Radians. Inside this bearing error the bot considers itself on target and starts charging. */
export const BOT_FIRE_TOLERANCE = 0.12;
/** Radians of heading error at which the bot asks for full steering lock. */
export const BOT_STEER_FULL = 0.6;
/**
 * Channel index for a bot's RNG, alongside terrain (0), surfaces (1) and course layout (2).
 * `hashChannel(seed, index, BOT_CHANNEL, botIndex)` gives each bot its own independent stream,
 * so bot behaviour is reproducible per seed and no bot's draws shift another's.
 */
export const BOT_CHANNEL = 3;

/** Seconds of driving without making `BOT_PROGRESS_M` of headway before the bot calls itself stuck. */
export const BOT_STUCK_S = 2;
/** Seconds the bot reverses on full lock to get off whatever it was wedged against. */
export const BOT_UNSTICK_S = 1;
/** Metres a driving bot has to cover for it to count as getting somewhere. */
export const BOT_PROGRESS_M = 1;
/** The lowest charge a bot lets go at: `Cart` only fires a release with some charge on it. */
const MIN_RELEASE_CHARGE = 0.01;

/**
 * The little a bot remembers between ticks, owned by its rig in `world.ts`. The intent function
 * stays a function of its inputs; this is one of them.
 *
 * - `skill`, 0..1, fixed for the bot's life and drawn from its own seeded stream: how tight its
 *   shots are and how fast it slews. 0.5 is the untuned bot.
 * - `stuckFor`/`unstickFor`/`anchor*`: progress tracking, for backing off an obstacle it has been
 *   driving into. Driving is a straight line with no pathfinding (see `BOT_ENGAGE_RANGE`), so a
 *   tree between a bot and its target used to hold it there for the rest of the match.
 * - `hasAmmoTarget`/`ammoX`/`ammoZ`: the nearest ammo, written by `world.ts` each tick, which a
 *   bot with an empty magazine drives to instead of at the enemy.
 */
export interface BotMind {
  skill: number;
  stuckFor: number;
  unstickFor: number;
  anchorX: number;
  anchorZ: number;
  hasAmmoTarget: boolean;
  ammoX: number;
  ammoZ: number;
}

export function createBotMind(skill: number): BotMind {
  return { skill, stuckFor: 0, unstickFor: 0, anchorX: 0, anchorZ: 0, hasAmmoTarget: false, ammoX: 0, ammoZ: 0 };
}

/**
 * Channel index for a bot's skill draw, alongside `BOT_CHANNEL` and `SPAWN_CHANNEL`. Its own
 * stream rather than a draw from the bot's, so giving bots a skill shifts none of their other
 * draws.
 */
export const BOT_SKILL_CHANNEL = 5;

/**
 * What the bot is engaging. Not a `Cart`, because the bot must not be able to read its target's
 * ammo, charge or health -- and because `dead` is the only thing about the target beyond its
 * position that the bot is allowed to know.
 */
export interface BotTarget {
  readonly x: number;
  readonly z: number;
  /** A dead target is not engaged at all: that is what stops a bot camping a respawn point. */
  readonly dead: boolean;
}

/** `pickTarget`'s answer when there is no living enemy to fight. */
export const NO_TARGET = -1;

/**
 * Metres. A bot keeps the enemy it is already fighting unless another is at least this much
 * closer. Without it two enemies at similar range make the bot flick between them every tick and
 * fight neither.
 */
export const TARGET_SWITCH_MARGIN = 15;

/** What `pickTarget` may know about a cart: where it is and whether it is alive. */
export interface TargetCandidate {
  readonly position: { readonly x: number; readonly z: number };
  readonly dead: boolean;
}

/**
 * The rig index `self` should fight: the nearest living enemy (`teamOf`), holding on to `current`
 * while it is still a living enemy and nothing else is `TARGET_SWITCH_MARGIN` closer.
 * `NO_TARGET` when every enemy is dead. Allocation-free; it runs per bot per tick.
 */
export function pickTarget(self: number, current: number, carts: readonly TargetCandidate[]): number {
  const me = carts[self]!.position;
  const myTeam = teamOf(self);
  let best = NO_TARGET;
  let bestDistance = Infinity;
  let currentDistance = Infinity;
  for (let i = 0; i < carts.length; i++) {
    const other = carts[i]!;
    if (i === self || other.dead || teamOf(i) === myTeam) continue;
    const d = Math.hypot(other.position.x - me.x, other.position.z - me.z);
    if (i === current) currentDistance = d;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (currentDistance !== Infinity && bestDistance > currentDistance - TARGET_SWITCH_MARGIN) return current;
  return best;
}

/**
 * Writes this tick's intent for `bot` into `out`.
 *
 * Aim, drive and fire, and nothing else -- no pathfinding, no hazard avoidance beyond what
 * `cartSpeedScale` already does for free through the shared `Cart.step`, no seeking out an ammo
 * bucket when it runs dry. Those are real navigation problems and are deliberately deferred.
 *
 * The firing model is the interesting part. `Cart.step` charges while `fire` is held and shoots
 * on the *release* edge, so a bot that simply held the trigger would never fire. Instead the bot
 * reads its own `charge` and lets go once it is charged enough -- which makes a charge-and-release
 * weapon drivable from a function with no state of its own.
 *
 * `random` is consumed at most once per call, and only on a release tick.
 */
export function computeBotIntent(
  bot: Cart,
  target: BotTarget,
  dt: number,
  random: () => number,
  out: PlayerIntent,
  mind: BotMind | null = null,
): void {
  out.throttle = 0;
  out.steer = 0;
  out.brake = false;
  out.aimDelta = 0;
  out.fire = false;
  out.cancelCharge = false;
  out.selectClub = null;

  // Backing off an obstacle overrides everything else until it is done.
  if (mind !== null && mind.unstickFor > 0) {
    mind.unstickFor -= dt;
    out.throttle = -1;
    out.steer = 1;
    if (mind.unstickFor <= 1e-9) {
      mind.unstickFor = 0;
      resetProgress(bot, mind);
    }
    return;
  }

  // An empty magazine sends the bot to the nearest ammo, all the way onto it: a bot that holds
  // station at its enemy with nothing to shoot is a target, not an opponent.
  if (mind !== null && bot.ammo <= 0 && mind.hasAmmoTarget) {
    const ax = mind.ammoX - bot.position.x;
    const az = mind.ammoZ - bot.position.z;
    out.steer = clampSigned(wrapAngle(Math.atan2(az, ax) - bot.heading) / BOT_STEER_FULL);
    out.throttle = 1;
    trackProgress(bot, mind, dt, out);
    return;
  }

  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const distance = Math.hypot(dx, dz);
  if (target.dead || distance < 1e-6) {
    if (mind !== null) resetProgress(bot, mind);
    return;
  }

  const bearing = Math.atan2(dz, dx);

  // Drive: turn the chassis toward the target and close to the standoff, then hold station. This
  // runs at any distance -- see `BOT_ENGAGE_RANGE` for why it no longer stops at it.
  const headingError = wrapAngle(bearing - bot.heading);
  out.steer = clampSigned(headingError / BOT_STEER_FULL);
  out.throttle = distance > BOT_STANDOFF ? 1 : 0;
  out.brake = distance < BOT_STANDOFF * 0.5;
  if (mind !== null && trackProgress(bot, mind, dt, out)) return;

  // Beyond the tracking range the bot only drives -- no aim, no fire. Closing changed where the
  // bot goes (see `BOT_ENGAGE_RANGE`), not what it can hit.
  if (distance > BOT_ENGAGE_RANGE) return;

  // Skill 0.5 is exactly the untuned bot: both scales are 1 there.
  const skill = mind === null ? 0.5 : mind.skill;
  const aimRate = BOT_AIM_RATE * (0.75 + 0.5 * skill);
  const spreadScale = 1.6 - 1.2 * skill;

  // Aim: ease the turret toward the bearing at a bounded rate. Done from the full tracking range
  // so the turret is lined up before the target is close enough to shoot.
  const aimError = wrapAngle(bearing - bot.turretYaw);
  const maxSlew = aimRate * dt;
  out.aimDelta = Math.min(maxSlew, Math.max(-maxSlew, aimError));

  // Fire only within the putter's actual reach, on top of being aimed and having ammo -- see
  // `BOT_FIRE_RANGE` for why a bot that shot the moment it had a bearing would just waste its
  // magazine. It lets go at the charge `solveShot` gives for this range.
  const wantsToFire =
    distance <= BOT_FIRE_RANGE && Math.abs(aimError) < BOT_FIRE_TOLERANCE && bot.ammo > 0;
  const release = Math.max(MIN_RELEASE_CHARGE, solveShot(bot.equippedClub, distance));
  out.fire = wantsToFire && bot.charge < release;

  // On the release tick, offset the turret inside the club's own accuracy cone, widened or
  // tightened by skill. The player's shots are deliberately unaffected.
  if (wantsToFire && !out.fire) {
    out.aimDelta += applyAimSpread(0, bot.equippedClub, random) * spreadScale;
  }
}

/**
 * Counts time spent driving without headway, and starts backing off once it reaches
 * `BOT_STUCK_S`. Returns true when it has taken over `out` for that. Holding station is not
 * driving, so it never counts.
 */
function trackProgress(bot: Cart, mind: BotMind, dt: number, out: PlayerIntent): boolean {
  if (out.throttle <= 0) {
    resetProgress(bot, mind);
    return false;
  }
  if (Math.hypot(bot.position.x - mind.anchorX, bot.position.z - mind.anchorZ) > BOT_PROGRESS_M) {
    resetProgress(bot, mind);
    return false;
  }
  mind.stuckFor += dt;
  if (mind.stuckFor < BOT_STUCK_S - 1e-9) return false;
  mind.stuckFor = 0;
  mind.unstickFor = BOT_UNSTICK_S;
  out.throttle = -1;
  out.steer = 1;
  out.brake = false;
  return true;
}

function resetProgress(bot: Cart, mind: BotMind): void {
  mind.stuckFor = 0;
  mind.anchorX = bot.position.x;
  mind.anchorZ = bot.position.z;
}

/** Folds an angle into [-PI, PI], so an error either side of the wrap turns the short way. */
function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

function clampSigned(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
