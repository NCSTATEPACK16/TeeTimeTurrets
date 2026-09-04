import { applyAimSpread } from "../physics/Ballistics";
import type { PlayerIntent } from "../input/InputSource";
import type { Cart } from "./entities/Cart";

/**
 * The AI opponent, as one pure function of exactly the state it needs: its own cart, and where
 * the thing it is fighting happens to be. Structural rather than a method on `Cart` or `Sim`,
 * the same way `hudState.ts`'s `HudSource` is -- it makes the whole behaviour testable with no
 * Rapier world and no `Sim` at all.
 *
 * DOM-free and Rapier-free like everything else in `src/sim/**`. Deliberately has no memory:
 * everything it needs to decide is already on the cart it is driving.
 */

/** Metres. Outside this the bot idles rather than pathfinding across the course. */
export const BOT_ENGAGE_RANGE = 40;
/** Metres. Inside this the bot stops closing -- a cart nose-to-nose cannot bring its barrel to bear. */
export const BOT_STANDOFF = 12;
/** Radians per second of turret slew. Bounded so the bot's aim is not instant and omniscient. */
export const BOT_AIM_RATE = 1.2;
/** Radians. Inside this bearing error the bot considers itself on target and starts charging. */
export const BOT_FIRE_TOLERANCE = 0.12;
/** Radians of heading error at which the bot asks for full steering lock. */
export const BOT_STEER_FULL = 0.6;
/** Charge fraction at which the bot lets go of the trigger. */
export const BOT_CHARGE_RELEASE = 0.8;
/**
 * Channel index for a bot's RNG, alongside terrain (0), surfaces (1) and course layout (2).
 * `hashChannel(seed, index, BOT_CHANNEL, botIndex)` gives each bot its own independent stream,
 * so bot behaviour is reproducible per seed and no bot's draws shift another's.
 */
export const BOT_CHANNEL = 3;

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
): void {
  out.throttle = 0;
  out.steer = 0;
  out.brake = false;
  out.aimDelta = 0;
  out.fire = false;
  out.selectClub = null;

  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const distance = Math.hypot(dx, dz);
  if (target.dead || distance > BOT_ENGAGE_RANGE || distance < 1e-6) return;

  const bearing = Math.atan2(dz, dx);

  // Drive: turn the chassis toward the target and close to the standoff, then hold station.
  const headingError = wrapAngle(bearing - bot.heading);
  out.steer = clampSigned(headingError / BOT_STEER_FULL);
  out.throttle = distance > BOT_STANDOFF ? 1 : 0;
  out.brake = distance < BOT_STANDOFF * 0.5;

  // Aim: ease the turret toward the bearing at a bounded rate.
  const aimError = wrapAngle(bearing - bot.turretYaw);
  const maxSlew = BOT_AIM_RATE * dt;
  out.aimDelta = Math.min(maxSlew, Math.max(-maxSlew, aimError));

  const wantsToFire = Math.abs(aimError) < BOT_FIRE_TOLERANCE && bot.ammo > 0;
  out.fire = wantsToFire && bot.charge < BOT_CHARGE_RELEASE;

  // On the release tick, offset the turret inside the club's own accuracy cone. This is the
  // per-shot spread channel `applyAimSpread` was written for and never had a caller for; the
  // player's shots are deliberately unaffected.
  if (wantsToFire && !out.fire) {
    out.aimDelta += applyAimSpread(0, bot.equippedClub, random);
  }
}

/** Folds an angle into [-PI, PI], so an error either side of the wrap turns the short way. */
function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

function clampSigned(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
