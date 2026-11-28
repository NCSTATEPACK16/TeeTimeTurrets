import { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "../sim/intent";
import type { PlayerIntent } from "../sim/intent";

/**
 * A gamepad to intent, as a pure function of the button and axis state (Stage 4b, spec
 * `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md` §2.1), the way
 * `intentFromKeys` is for keys. The browser shell (`GamepadSource`) only copies the pad's state
 * into a `PadFrame` once a tick; every decision is here, where Vitest can see it.
 *
 * Indices are the Gamepad API's `standard` mapping, which names buttons by **position**, not by
 * the letter printed on them. The test pad, an 8BitDo SN30 Pro, has Nintendo letters: its bottom
 * face button reads B and its right one reads A. So "B cancels" below is index 0, the bottom.
 *
 * ```
 *   L2 brake                 R2 fire (hold to charge)
 *   L1 previous club         R1 next club
 *   D-pad left/up/right: putter / iron / driver
 *   B (bottom) cancel charge   X (top) Mulligan Mortar
 *   Left stick: Y throttle, X steer      Right stick: X turret yaw rate
 *   Select: map (as M)       Start: pause (as Esc)      Y (left): horn (as H)
 * ```
 *
 * Select, Start and the horn are the match screen's, not the cart's, so they come out of
 * `padMenuEdges`, not the intent. A (right) has no match action.
 */

export const PAD = {
  /** Bottom face. SN30 Pro: B. */
  bottom: 0,
  /** Right face. SN30 Pro: A. */
  right: 1,
  /** Left face. SN30 Pro: Y. */
  left: 2,
  /** Top face. SN30 Pro: X. */
  top: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  select: 8,
  start: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  dleft: 14,
  dright: 15,
} as const;

export const PAD_BUTTONS = 17;
export const PAD_AXES = 4;

/**
 * Below this stick deflection the stick reads exactly 0 on both axes. A radial deadzone, so a
 * stick resting slightly off-centre in any direction is still at rest. **Exactly** 0 matters: the
 * cart's throttle spool restarts whenever the throttle's sign changes or it touches 0, so a stick
 * jittering round its centre would keep restarting it (Stage 4, `CART_TUNING.spoolSeconds`).
 */
export const STICK_DEADZONE = 0.18;
/** Peak turret yaw rate from the right stick, in rad/s: the keyboard's Q/E rate to start. */
export const AIM_PEAK_RAD_S = 1.6;
/** The right stick's response curve: rate = peak * deflection^this, so fine aim is easy. */
export const AIM_EXPONENT = 2;
/** The sim's fixed step. `aimDelta` is radians per tick. */
const TICK_S = 1 / 60;

/**
 * One tick of a pad: this tick's buttons, last tick's, and the axes. `buttons` and `prev` are 0/1
 * per standard index; a press is a 1 that was a 0.
 */
export interface PadFrame {
  readonly buttons: ArrayLike<number>;
  readonly prev: ArrayLike<number>;
  readonly axes: ArrayLike<number>;
}

const CLUB_ORDER: readonly ClubType[] = [ClubType.Putter, ClubType.Iron, ClubType.Driver];

function held(pad: PadFrame, i: number): boolean {
  return (pad.buttons[i] ?? 0) > 0;
}

function pressed(pad: PadFrame, i: number): boolean {
  return (pad.buttons[i] ?? 0) > 0 && !((pad.prev[i] ?? 0) > 0);
}

/**
 * A stick's two axes after the radial deadzone, rescaled so the edge of the deadzone is 0 and full
 * deflection is still 1, written into `out`. Inside the deadzone both are exactly 0.
 */
export function deadzoneStick(x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= STICK_DEADZONE) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scale = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
  out.x = x * scale;
  out.y = y * scale;
  return out;
}

const leftScratch = { x: 0, y: 0 };
const rightScratch = { x: 0, y: 0 };

/**
 * The intent for one tick of `pad`. `club` is the club equipped now, which L1/R1 step from.
 * `out` is reused, as `intentFromKeys`'s is; left out, it allocates, which is what tests want.
 */
export function intentFromPad(pad: PadFrame, club: ClubType, out: PlayerIntent = neutralIntent()): PlayerIntent {
  const left = deadzoneStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, leftScratch);
  // The API reads a stick pushed up as negative Y.
  out.throttle = left.y === 0 ? 0 : -left.y;
  out.steer = left.x;
  out.brake = held(pad, PAD.l2);
  out.fire = held(pad, PAD.r2);
  out.cancelCharge = pressed(pad, PAD.bottom);
  out.callMortar = pressed(pad, PAD.top);

  const right = deadzoneStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, rightScratch);
  const x = right.x;
  out.aimDelta = x === 0 ? 0 : Math.sign(x) * Math.abs(x) ** AIM_EXPONENT * AIM_PEAK_RAD_S * TICK_S;

  out.selectClub = null;
  if (pressed(pad, PAD.dleft)) out.selectClub = ClubType.Putter;
  else if (pressed(pad, PAD.up)) out.selectClub = ClubType.Iron;
  else if (pressed(pad, PAD.dright)) out.selectClub = ClubType.Driver;
  else if (pressed(pad, PAD.l1) || pressed(pad, PAD.r1)) {
    const at = Math.max(0, CLUB_ORDER.indexOf(club));
    const step = pressed(pad, PAD.r1) ? 1 : CLUB_ORDER.length - 1;
    out.selectClub = CLUB_ORDER[(at + step) % CLUB_ORDER.length]!;
  }
  return out;
}

/** The match screen's buttons this tick: presses, not holds. */
export interface PadMenuEdges {
  pause: boolean;
  map: boolean;
  horn: boolean;
}

export function padMenuEdges(pad: PadFrame, out: PadMenuEdges): PadMenuEdges {
  out.pause = pressed(pad, PAD.start);
  out.map = pressed(pad, PAD.select);
  out.horn = pressed(pad, PAD.left);
  return out;
}

/** True when anything on the pad is pressed or a stick is past its deadzone: "the pad is in use". */
export function padActive(pad: PadFrame): boolean {
  for (let i = 0; i < pad.buttons.length; i++) if ((pad.buttons[i] ?? 0) > 0) return true;
  return (
    Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > STICK_DEADZONE ||
    Math.hypot(pad.axes[2] ?? 0, pad.axes[3] ?? 0) > STICK_DEADZONE
  );
}
