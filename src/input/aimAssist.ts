/**
 * Aim assist for the pad (Stage 4b, spec §2.2): the right stick turns the turret slower while it
 * is lined up on a visible enemy, so a twin-stick player can hold a target a mouse player would
 * simply click on. It only ever **scales** the aim the pad emits. It reads where the carts are and
 * which enemies the player can see, and writes nothing back. The sim, the bots, the golden and a
 * future server never know it exists, and keyboard and mouse never get it (`MatchInput`).
 *
 * Measured from the turret's yaw, not the screen centre: the chase camera sits 0.7 m to the
 * turret's right (`CHASE_SIDE`), so the middle of the screen is not where a shot goes.
 *
 * Pure and allocation-free, so it runs every tick and is tested in node.
 */

/** Inside this angle either side of an enemy, the stick slows. About 9°. */
export const ASSIST_CONE_RAD = 0.15;
/** The stick's rate dead on an enemy: 40% of what the player asked for. */
export const ASSIST_MIN_SCALE = 0.4;
/** Further than this, nothing slows: about the iron's reach. */
export const ASSIST_RANGE_M = 70;

/** One cart the player might be aiming at. */
export interface AssistTarget {
  x: number;
  z: number;
  /** An enemy, alive, and in the player's line of sight right now. */
  eligible: boolean;
}

/**
 * The factor to multiply the pad's `aimDelta` by this tick: 1 away from every eligible target,
 * falling linearly to `ASSIST_MIN_SCALE` on the nearest one's bearing. `count` targets of
 * `targets` are read, so a caller can keep one fixed array.
 */
export function aimAssistScale(
  turretYaw: number,
  fromX: number,
  fromZ: number,
  targets: readonly AssistTarget[],
  count: number,
): number {
  let scale = 1;
  for (let i = 0; i < count; i++) {
    const t = targets[i]!;
    if (!t.eligible) continue;
    const dx = t.x - fromX;
    const dz = t.z - fromZ;
    const d = Math.hypot(dx, dz);
    if (d > ASSIST_RANGE_M || d < 1e-6) continue;
    const off = Math.abs(wrap(Math.atan2(dz, dx) - turretYaw));
    if (off >= ASSIST_CONE_RAD) continue;
    const s = ASSIST_MIN_SCALE + (1 - ASSIST_MIN_SCALE) * (off / ASSIST_CONE_RAD);
    if (s < scale) scale = s;
  }
  return scale;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
