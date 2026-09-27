import type { PlayerIntent } from "../sim/intent";

/**
 * The input *interface*, written against image 14's touch control inventory rather than against
 * a keyboard (UI-SPEC.md §4). Throttle and steer are axes, aim is a delta, fire is a held
 * button -- all things a thumbstick, a gamepad and a scripted test array can produce as
 * naturally as a key. If any of these were key states, the Phase 4 touch layer would be a
 * refactor of every input path instead of one new class.
 *
 * The intent itself is the sim's type (`sim/intent.ts`): the sim consumes it, so the input layer
 * depends on the sim and never the reverse. Re-exported here for the sources that produce it.
 */
export { neutralIntent } from "../sim/intent";
export type { PlayerIntent } from "../sim/intent";

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
