import { hasLineOfSight } from "../sim/lineOfSight";
import type { HeightSampler } from "../sim/lineOfSight";
import { COARSE_RANGE_M } from "./plateState";

/**
 * When each enemy nameplate walks its sight line, and what it last found.
 *
 * Walking one is up to 150 `heightAt` samples, and every enemy walked every frame came to about
 * 3,500 a frame -- against the blended course ground, several milliseconds. A plate does not need
 * a fresh answer sixty times a second: an enemy fades over `ENEMY_FADE_S` once it is lost, so a
 * tenth of a second of staleness is inside what the player could ever see. So:
 *
 * - **Only when it can matter.** Allies always show through terrain and are never walked. An enemy
 *   off screen draws no plate, and one past `SIGHT_RANGE_M` is too far to be worth a plate, so
 *   neither is walked, and both read as unseen.
 * - **At `SIGHT_INTERVAL_MS`, staggered.** Plate `i` of `n` walks on its own slot, `i / n` of an
 *   interval after plate 0's, so the work is spread across frames instead of landing in one.
 * - **Immediately when it has no answer**, or when its slot passed while it was not being asked --
 *   a plate coming back on screen is walked that frame rather than showing a stale answer.
 *
 * DOM-free and allocation-free per call: it runs once per plate per frame.
 */

/** How often each enemy's sight line is walked. */
export const SIGHT_INTERVAL_MS = 100;

/** Past this flat distance an enemy's plate is not walked and reads as unseen: the range a plate
 *  stops reporting a distance at, so the plate that disappears is one already showing no number. */
export const SIGHT_RANGE_M = COARSE_RANGE_M;

/** One plate's question, in the caller's reused object. */
export interface SightQuery {
  readonly enemy: boolean;
  readonly onScreen: boolean;
  readonly fromX: number;
  readonly fromY: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toY: number;
  readonly toZ: number;
}

export class Sightlines {
  private readonly seen: boolean[];
  /** When each plate may next walk; -Infinity until its first walk, so the first ask walks. */
  private readonly nextMs: number[];
  private readonly offsetMs: number[];

  constructor(count: number) {
    this.seen = new Array<boolean>(count).fill(false);
    this.nextMs = new Array<number>(count).fill(Number.NEGATIVE_INFINITY);
    this.offsetMs = Array.from({ length: count }, (_, i) => (i / Math.max(1, count)) * SIGHT_INTERVAL_MS);
  }

  canSee(plate: number, q: SightQuery, ground: HeightSampler, nowMs: number): boolean {
    if (!q.enemy) return true;
    if (!q.onScreen || Math.hypot(q.toX - q.fromX, q.toZ - q.fromZ) > SIGHT_RANGE_M) {
      this.seen[plate] = false;
      return false;
    }
    if (nowMs < this.nextMs[plate]!) return this.seen[plate]!;

    this.seen[plate] = hasLineOfSight(ground, q.fromX, q.fromY, q.fromZ, q.toX, q.toY, q.toZ);
    // The next of this plate's own slots after now: slots sit at offset + k * interval, so a plate
    // stays on its slot however late or early it was asked.
    const offset = this.offsetMs[plate]!;
    this.nextMs[plate] = offset + (Math.floor((nowMs - offset) / SIGHT_INTERVAL_MS) + 1) * SIGHT_INTERVAL_MS;
    return this.seen[plate]!;
  }
}
