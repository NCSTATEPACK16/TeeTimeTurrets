import { ClubType } from "../physics/Ballistics";
import type { SimEvent } from "../sim/events";

/**
 * Camera shake as **trauma**: a 0..1 value that events add to and time bleeds away, with the shake
 * itself proportional to trauma squared. The square is the point -- a small knock is barely a
 * tremor, a big one is violent, and stacking two knocks feels worse than twice one. Built for
 * Stage 2's hits and kills; Stage 4's landings and terrain feed the same value.
 *
 * Render-only. The offset is smooth noise of wall time, not a random draw, so it neither touches
 * the sim's seeded streams nor jitters differently at different frame rates.
 */

/** Trauma lost per second. From full, a shake is gone in about 0.7 s. */
export const TRAUMA_DECAY_PER_S = 1.4;
/** Metres the eye moves at full trauma. */
export const SHAKE_MAX_OFFSET_M = 0.35;
/** Radians of roll at full trauma. */
export const SHAKE_MAX_ROLL = 0.05;

export interface ShakeOffset {
  x: number;
  y: number;
  roll: number;
}

export class Trauma {
  value = 0;

  add(amount: number): void {
    this.value = Math.min(1, this.value + amount);
  }

  update(dt: number): void {
    this.value = Math.max(0, this.value - TRAUMA_DECAY_PER_S * dt);
  }

  /** The shake at time `t` (seconds), in the camera's own right/up/roll. */
  offset(t: number, out: ShakeOffset): void {
    const shake = this.value * this.value;
    if (shake === 0) {
      out.x = 0;
      out.y = 0;
      out.roll = 0;
      return;
    }
    out.x = SHAKE_MAX_OFFSET_M * shake * smoothNoise(t, 17.3, 0.0);
    out.y = SHAKE_MAX_OFFSET_M * shake * smoothNoise(t, 13.1, 1.7);
    out.roll = SHAKE_MAX_ROLL * shake * smoothNoise(t, 9.7, 3.1);
  }
}

/**
 * A cheap, smooth signal in [-1, 1]: three incommensurate sines, normalised by their summed
 * amplitude. Enough to read as noise at shake frequencies without a noise library in the loop.
 */
function smoothNoise(t: number, frequency: number, phase: number): number {
  return (
    (Math.sin(t * frequency + phase) +
      0.5 * Math.sin(t * frequency * 2.13 + phase * 1.9) +
      0.25 * Math.sin(t * frequency * 4.37 + phase * 3.3)) /
    1.75
  );
}

/** How much a player-fired shot of each club kicks the camera. The driver is the one to feel. */
const SHOT_TRAUMA: Record<ClubType, number> = {
  [ClubType.Putter]: 0.06,
  [ClubType.Iron]: 0.2,
  [ClubType.Driver]: 0.38,
};
const HURT_TRAUMA = 0.45;
const DIED_TRAUMA = 0.75;
const SCORED_KILL_TRAUMA = 0.25;

/** What an event does to the player's camera. Only the player's own fight shakes it. */
export function traumaFor(e: SimEvent): number {
  switch (e.kind) {
    case "shot":
      return e.actor === 0 && e.club !== null ? SHOT_TRAUMA[e.club] : 0;
    case "hit":
      return e.target === 0 ? HURT_TRAUMA : 0;
    case "kill":
      if (e.target === 0) return DIED_TRAUMA;
      return e.actor === 0 ? SCORED_KILL_TRAUMA : 0;
    default:
      return 0;
  }
}
