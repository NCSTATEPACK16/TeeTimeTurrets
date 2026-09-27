import type { ClubType } from "../physics/Ballistics";
import type { CartIntent } from "./entities/Cart";

/**
 * One tick of what a cart's driver wants: the cart's own controls plus a club choice.
 *
 * It lives in the sim rather than in `src/input/**` because the sim consumes it -- `Sim.step`, the
 * bot AI and a future server all speak it -- and the dependency has to run from the input layer
 * into the sim, never the other way. `input/InputSource.ts` re-exports it for the sources that
 * produce it.
 */
export interface PlayerIntent extends CartIntent {
  /** A club to switch to this tick, or null to keep the equipped one. */
  selectClub: ClubType | null;
}

/** A fresh idle intent: no throttle, no steer, nothing held. */
export function neutralIntent(): PlayerIntent {
  return {
    throttle: 0,
    steer: 0,
    brake: false,
    aimDelta: 0,
    fire: false,
    cancelCharge: false,
    selectClub: null,
  };
}
