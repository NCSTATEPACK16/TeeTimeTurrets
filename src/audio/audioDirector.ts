import { ClubType } from "../physics/Ballistics";
import type { SimEvent } from "../sim/events";

/**
 * Which sound a match event makes, how loud, and from which side. DOM-free and WebAudio-free so
 * it is tested in node; `audioEngine.ts` plays what this decides.
 *
 * The player's own actions play at full volume from the centre. Other carts' are placed by
 * distance and bearing from the player, as the chase camera faces, and fall silent past
 * `HEARING_RANGE_M`.
 */

export type Cue =
  | "pop"
  | "clack"
  | "thwack"
  | "hit"
  | "hurt"
  | "kill"
  | "death"
  | "blast"
  | "pickup"
  | "shield"
  | "plate"
  | "dry"
  | "splash";

export interface CuePlay {
  cue: Cue;
  /** 0..1, on top of the SFX bus. */
  gain: number;
  /** -1 left .. 1 right. */
  pan: number;
}

export interface Listener {
  x: number;
  z: number;
  /** The camera's yaw, which is the turret's. */
  yaw: number;
}

export const HEARING_RANGE_M = 90;
/** Inside this, a sound is at full distance volume. */
const NEAR_M = 6;

const PLAYER = 0;

/** A fresh object per cue: sounds are rare next to frames, and the caller plays and drops it. */
export function cueFor(e: SimEvent, listener: Listener): CuePlay | null {
  switch (e.kind) {
    case "shot": {
      const cue: Cue = e.club === ClubType.Driver ? "thwack" : e.club === ClubType.Iron ? "clack" : "pop";
      return e.actor === PLAYER ? centre(cue) : placed(cue, e, listener);
    }
    case "hit":
    case "ram":
      if (e.actor === PLAYER) return centre("hit");
      if (e.target === PLAYER) return centre("hurt");
      return null;
    case "kill":
      if (e.target === PLAYER) return centre("death");
      if (e.actor === PLAYER) return centre("kill");
      return placed("blast", e, listener);
    case "pickup":
      return e.actor === PLAYER ? centre("pickup") : null;
    case "shieldGained":
      return e.actor === PLAYER ? centre("shield") : null;
    case "plateBroken":
      // The player's own plate, or one the player knocked off; anyone else's is heard in place.
      return e.target === PLAYER || e.actor === PLAYER ? centre("plate") : placed("plate", e, listener);
    case "dry":
      return e.actor === PLAYER ? centre("dry") : null;
    case "splash":
      return e.actor === PLAYER ? centre("splash") : placed("splash", e, listener);
    case "respawn":
      return null;
  }
}

function centre(cue: Cue): CuePlay {
  return { cue, gain: 1, pan: 0 };
}

function placed(cue: Cue, e: SimEvent, listener: Listener): CuePlay | null {
  const dx = e.x - listener.x;
  const dz = e.z - listener.z;
  const d = Math.hypot(dx, dz);
  if (d > HEARING_RANGE_M) return null;
  const gain = d <= NEAR_M ? 1 : Math.max(0, 1 - (d - NEAR_M) / (HEARING_RANGE_M - NEAR_M)) ** 1.5;
  // The listener's right is (-sin yaw, cos yaw), as in hitFeedback.damageScreenAngle.
  const right = d > 0 ? (-dx * Math.sin(listener.yaw) + dz * Math.cos(listener.yaw)) / d : 0;
  return { cue, gain: Math.min(1, gain), pan: Math.max(-1, Math.min(1, right)) };
}

/**
 * Seconds between heartbeat thumps for a low-health intensity (`hitFeedback.lowHpIntensity`):
 * none when not low, from about one a second down to about three a second near death.
 */
export function heartbeatInterval(intensity: number): number {
  if (intensity <= 0) return Infinity;
  return 1.1 - 0.75 * Math.min(1, intensity);
}
