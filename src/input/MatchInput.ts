import type { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "../sim/intent";
import type { PlayerIntent } from "../sim/intent";
import type { InputSource } from "./InputSource";
import { GamepadSource } from "./GamepadSource";
import { KeyboardMouseSource } from "./KeyboardMouseSource";
import type { PadMenuEdges } from "./gamepadMapping";

/** Which input the player last used. Drives the pause rule, the glyphs and aim assist. */
export type ActiveInput = "keyboard" | "pad";

/**
 * Keyboard and mouse, and a gamepad, at once (Stage 4b). Either drives the cart; neither has to be
 * chosen. Each tick both are sampled and folded into one intent:
 * - axes: whichever is further from 0, so a pad left at rest never cancels a key;
 * - buttons: either;
 * - aim: the sum, since a mouse and a stick are both deltas;
 * - a club choice: the keyboard's if both made one this tick.
 *
 * `active` is whichever source last did anything, starting at the keyboard. It is what
 * `MatchScreen` asks before treating a lost pointer lock as a pause: on a pad there is no lock to
 * lose (spec §1, "Pointer lock does not exist on iOS").
 */
export class MatchInput implements InputSource {
  readonly keyboard: KeyboardMouseSource;
  readonly pad = new GamepadSource();
  private readonly intent: PlayerIntent = neutralIntent();
  active: ActiveInput = "keyboard";

  constructor(canvas: HTMLElement) {
    this.keyboard = new KeyboardMouseSource(canvas);
  }

  /** The player's mouse sensitivity setting. */
  set sensitivity(value: number) {
    this.keyboard.sensitivity = value;
  }

  /** The club equipped now, which the pad's L1/R1 step from. */
  set club(value: ClubType) {
    this.pad.club = value;
  }

  /**
   * Reads the pad and the keyboard's state for this tick. Call once per tick, before `sample()` and
   * `menuEdges()`, paused or not, so a Start press is seen while the match is frozen.
   */
  poll(): void {
    this.pad.poll();
    if (this.pad.active) this.active = "pad";
    else if (this.keyboard.active) this.active = "keyboard";
  }

  sample(): PlayerIntent {
    const k = this.keyboard.sample();
    const p = this.pad.sample();
    const out = this.intent;
    out.throttle = pickAxis(k.throttle, p.throttle);
    out.steer = pickAxis(k.steer, p.steer);
    out.brake = k.brake || p.brake;
    out.fire = k.fire || p.fire;
    out.cancelCharge = k.cancelCharge || p.cancelCharge;
    out.callMortar = k.callMortar || p.callMortar;
    out.aimDelta = k.aimDelta + p.aimDelta;
    out.selectClub = k.selectClub ?? p.selectClub;
    return out;
  }

  /** Start, Select and the pad's horn this tick. */
  menuEdges(): PadMenuEdges {
    return this.pad.menuEdges();
  }

  lockPointer(): void {
    if (this.active === "keyboard") this.keyboard.lockPointer();
  }

  endTick(): void {
    this.keyboard.endTick();
    this.pad.endTick();
  }

  dispose(): void {
    this.keyboard.dispose();
    this.pad.dispose();
  }
}

function pickAxis(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}
