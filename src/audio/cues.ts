import { ClubType } from "../physics/Ballistics";
import type { SimEvent } from "../sim/events";

/**
 * The DOM-free half of the game's sound: which sound an event makes, and how loud and where. The
 * WebAudio half (`synth.ts`) only plays what this decides, so every rule here runs in Node.
 *
 * The player hears their own fight close up and centred -- their shots, the hits they land, the
 * ones they take, their pickups -- and everyone else's placed where it happened, fading with
 * distance and panned by bearing from where the camera looks (along the turret).
 */

export type SoundCue =
  | "putter"
  | "iron"
  | "driver"
  | "dryfire"
  | "hit"
  | "hurt"
  | "kill"
  | "died"
  | "pickup"
  | "splash"
  | "respawn";

export interface CueRequest {
  cue: SoundCue;
  /** 0..1, before the volume settings. */
  gain: number;
  /** -1 hard left .. 1 hard right. */
  pan: number;
}

/** Where the player hears from: the cart, facing along the turret. */
export interface Listener {
  x: number;
  z: number;
  yaw: number;
}

/** Metres past which another cart's fight is inaudible. About a hole's width. */
export const HEARING_RANGE_M = 120;
/** Someone else's hits and kills are quieter than their shots: the shot is the loud part. */
const DISTANT_IMPACT_GAIN = 0.6;

const SHOT_CUE: Record<ClubType, SoundCue> = {
  [ClubType.Putter]: "putter",
  [ClubType.Iron]: "iron",
  [ClubType.Driver]: "driver",
};

export function createCueRequest(): CueRequest {
  return { cue: "hit", gain: 0, pan: 0 };
}

const spatialScratch = { gain: 0, pan: 0 };

/**
 * Writes the sound `e` makes for `listener` into `out`, and says whether it makes one at all.
 * Writes into a caller-held object: this runs for every event, inside the render loop.
 */
export function cueFor(e: SimEvent, listener: Listener, out: CueRequest): boolean {
  switch (e.kind) {
    case "shot":
      if (e.club === null) return false;
      return e.actor === 0 ? close(out, SHOT_CUE[e.club]) : placed(out, SHOT_CUE[e.club], listener, e, 1);
    case "dryfire":
      return e.actor === 0 && close(out, "dryfire");
    case "hit":
      if (e.target === 0) return close(out, "hurt");
      if (e.actor === 0) return close(out, "hit");
      return placed(out, "hit", listener, e, DISTANT_IMPACT_GAIN);
    case "kill":
      if (e.target === 0) return close(out, "died");
      if (e.actor === 0) return close(out, "kill");
      return placed(out, "kill", listener, e, DISTANT_IMPACT_GAIN);
    case "pickup":
      return e.actor === 0 && close(out, "pickup");
    case "splash":
      return e.target === 0 ? close(out, "splash") : placed(out, "splash", listener, e, 1);
    case "respawn":
      return e.target === 0 && close(out, "respawn");
    default:
      return false;
  }
}

function close(out: CueRequest, cue: SoundCue): true {
  out.cue = cue;
  out.gain = 1;
  out.pan = 0;
  return true;
}

function placed(out: CueRequest, cue: SoundCue, listener: Listener, e: SimEvent, scale: number): boolean {
  spatialize(listener, e.x, e.z, spatialScratch);
  if (spatialScratch.gain <= 0) return false;
  out.cue = cue;
  out.gain = spatialScratch.gain * scale;
  out.pan = spatialScratch.pan;
  return true;
}

/**
 * Loudness and pan for a sound at (x, z). Loudness falls with the square of the fraction of
 * hearing range covered -- a quick, cheap stand-in for the inverse square that still reaches zero
 * at the edge. Pan is the sine of the bearing off the listener's facing: +Z is on the right when
 * looking down +X, the same convention as the damage flash.
 */
export function spatialize(listener: Listener, x: number, z: number, out: { gain: number; pan: number }): void {
  const dx = x - listener.x;
  const dz = z - listener.z;
  const d = Math.hypot(dx, dz);
  const near = Math.max(0, 1 - d / HEARING_RANGE_M);
  out.gain = near * near;
  out.pan = d < 1e-6 ? 0 : Math.sin(Math.atan2(dz, dx) - listener.yaw);
}

/** Speed, m/s, at which the engine is flat out. A street cart's top speed. */
const ENGINE_FULL_SPEED = 20;

/** The engine hum for the player's cart: pitch and level rise with speed either way. */
export function engineTone(speed: number): { frequency: number; gain: number } {
  const t = Math.min(1, Math.abs(speed) / ENGINE_FULL_SPEED);
  return { frequency: 55 + 75 * t, gain: 0.12 + 0.2 * t };
}

/**
 * Seconds between heartbeats for a low-health vignette at `vignette01`: none at 0, then from a
 * slow beat to a racing one as the vignette closes in.
 */
export function heartbeatPeriod(vignette01: number): number {
  if (vignette01 <= 0) return 0;
  return 1.1 - 0.6 * Math.min(1, vignette01);
}
