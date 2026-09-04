import { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "./InputSource";
import type { PlayerIntent } from "./InputSource";

/**
 * Keys to intent, as a pure function so the binding table is testable with no DOM. The browser
 * shell around it only has to collect three things: which keys are held, which went down this
 * tick, and how far the pointer moved.
 */

/**
 * Turret yaw per tick from the keyboard. Expressed per-tick rather than per-second because the
 * caller is the fixed 60 Hz step and nothing else may call this -- the pointer's own delta
 * arrives per-tick for the same reason. Roughly 1.6 rad/s, matching the Phase 0 aim rate.
 */
const TURRET_KEY_STEP = 1.6 / 60;

const FORWARD = ["KeyW", "ArrowUp"];
const REVERSE = ["KeyS", "ArrowDown"];
const LEFT = ["KeyA", "ArrowLeft"];
const RIGHT = ["KeyD", "ArrowRight"];

const CLUB_KEYS: Readonly<Record<string, ClubType>> = {
  Digit1: ClubType.Putter,
  Digit2: ClubType.Iron,
  Digit3: ClubType.Driver,
};

/**
 * `out` lets the caller reuse one object across ticks, per the AGENTS.md no-allocation rule;
 * omitting it allocates, which is what tests want and the hot loop must not do.
 *
 * Opposed keys cancel to zero rather than letting the last one checked win: holding W and S
 * together during a panic stop should coast, not lurch in whichever direction the `if` chain
 * happened to test second.
 */
export function intentFromKeys(
  keysDown: ReadonlySet<string>,
  keysPressedThisTick: ReadonlySet<string>,
  pointerAimDelta: number,
  out: PlayerIntent = neutralIntent(),
): PlayerIntent {
  out.throttle = axis(keysDown, FORWARD, REVERSE);
  out.steer = axis(keysDown, RIGHT, LEFT);
  out.brake = keysDown.has("ShiftLeft") || keysDown.has("ShiftRight");
  // F as well as Space: Space is the natural swing key when standing still, but it is awkward to
  // hold while the same hand is on WASD, so driving and firing at once wants a key under the
  // fingers already there.
  out.fire = keysDown.has("Space") || keysDown.has("KeyF");

  const keyTurn = (bool(keysDown.has("KeyE")) - bool(keysDown.has("KeyQ"))) * TURRET_KEY_STEP;
  out.aimDelta = pointerAimDelta + keyTurn;

  out.selectClub = null;
  for (const code of Object.keys(CLUB_KEYS)) {
    if (keysPressedThisTick.has(code)) {
      out.selectClub = CLUB_KEYS[code]!;
      break;
    }
  }

  return out;
}

function axis(keys: ReadonlySet<string>, positive: readonly string[], negative: readonly string[]): number {
  return bool(positive.some((k) => keys.has(k))) - bool(negative.some((k) => keys.has(k)));
}

function bool(v: boolean): number {
  return v ? 1 : 0;
}
