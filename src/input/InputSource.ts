import type { ClubType } from "../physics/Ballistics";
import type { CartIntent } from "../sim/entities/Cart";

/**
 * The input *interface*, written against image 14's touch control inventory rather than against
 * a keyboard (UI-SPEC.md §4). Throttle and steer are axes, aim is a delta, fire is a held
 * button -- all things a thumbstick, a gamepad and a scripted test array can produce as
 * naturally as a key. If any of these were key states, the Phase 4 touch layer would be a
 * refactor of every input path instead of one new class.
 */

/**
 * Everything the player can express in one tick. Extends the cart's own control intent with the
 * two edge-triggered choices that belong to the player rather than to the chassis.
 */
export interface PlayerIntent extends CartIntent {
  /** Set on the tick a club is chosen, null otherwise. Edge-triggered, not held. */
  selectClub: ClubType | null;
  /** Set on the tick the player asks to switch between stationary-swing and cart mode. */
  toggleMode: boolean;
}

export interface InputSource {
  /**
   * The intent for this tick. Called exactly once per fixed step. Implementations may return
   * the same mutable object every call -- the fixed loop must not allocate -- so callers must
   * consume it before the next `sample()` rather than storing the reference.
   */
  sample(): PlayerIntent;
  /** Called after `sample()` so delta-accumulating sources can zero their accumulators. */
  endTick(): void;
  dispose(): void;
}

export function neutralIntent(): PlayerIntent {
  return {
    throttle: 0,
    steer: 0,
    brake: false,
    aimDelta: 0,
    fire: false,
    selectClub: null,
    toggleMode: false,
  };
}
