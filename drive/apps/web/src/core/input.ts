import type { VehicleInput } from '../vehicle/VehicleModel';
import { inputConfig } from './inputConfig';

export interface Controls extends VehicleInput {
  reset: boolean;
  /** Switch between Chill and Joyride. */
  mode: boolean;
}

export const IDLE: Controls = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  reset: false,
  mode: false,
});

/** The subset of the Gamepad API the game reads; real Gamepad objects satisfy it. */
export interface GamepadLike {
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

const anyDown = (keys: ReadonlySet<string>, codes: readonly string[]) => codes.some((c) => keys.has(c));

export function readKeyboard(keys: ReadonlySet<string>): Controls {
  const k = inputConfig.keys;
  return {
    throttle: anyDown(keys, k.throttle) ? 1 : 0,
    brake: anyDown(keys, k.brake) ? 1 : 0,
    steer: (anyDown(keys, k.right) ? 1 : 0) - (anyDown(keys, k.left) ? 1 : 0),
    handbrake: anyDown(keys, k.handbrake),
    boost: anyDown(keys, k.boost),
    reset: anyDown(keys, k.reset),
    mode: anyDown(keys, k.mode),
  };
}

/** Rescales so the deadzone edge maps to 0 and full deflection to 1. */
export function applyDeadzone(v: number, deadzone: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  return (Math.sign(v) * (Math.min(a, 1) - deadzone)) / (1 - deadzone);
}

export function readGamepad(pad: GamepadLike | null | undefined): Controls {
  if (!pad || !pad.connected || pad.mapping !== 'standard') return IDLE;
  const g = inputConfig.gamepad;
  const button = (i: number) => pad.buttons[i]?.value ?? 0;
  const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
  return {
    throttle: applyDeadzone(button(g.throttleButton), g.triggerDeadzone),
    brake: applyDeadzone(button(g.brakeButton), g.triggerDeadzone),
    steer: applyDeadzone(pad.axes[g.steerAxis] ?? 0, g.deadzone),
    handbrake: pressed(g.handbrakeButton),
    boost: pressed(g.boostButton),
    reset: pressed(g.resetButton),
    mode: pressed(g.modeButton),
  };
}

/** Combine sources: the stronger pedal and steering input wins; buttons OR together. */
export function mergeControls(...sources: Controls[]): Controls {
  const out: Controls = { ...IDLE };
  for (const s of sources) {
    out.throttle = Math.max(out.throttle, s.throttle);
    out.brake = Math.max(out.brake, s.brake);
    if (Math.abs(s.steer) > Math.abs(out.steer)) out.steer = s.steer;
    out.handbrake ||= s.handbrake;
    out.boost ||= s.boost;
    out.reset ||= s.reset;
    out.mode ||= s.mode;
  }
  return out;
}

/**
 * Listens to the keyboard and polls gamepads. `reset` and `mode` fire once per press. A key
 * pressed and released between two polls (a quick tap on a slow frame) still counts once.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  /** Keys pressed since the last poll, kept until that poll even if already released. */
  private readonly tapped = new Set<string>();
  private resetHeld = false;
  private modeHeld = false;
  private readonly onDown = (e: KeyboardEvent) => {
    if (isBound(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (!e.repeat) this.tapped.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onBlur = () => {
    this.keys.clear();
    this.tapped.clear();
  };

  constructor(
    private readonly target: Window,
    private readonly getPads: () => readonly (GamepadLike | null)[] = () =>
      typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [],
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  poll(): Controls {
    const down = this.tapped.size ? new Set([...this.keys, ...this.tapped]) : this.keys;
    this.tapped.clear();
    const sources = [readKeyboard(down), ...this.getPads().map((p) => readGamepad(p))];
    const merged = mergeControls(...sources);
    const resetEdge = merged.reset && !this.resetHeld;
    const modeEdge = merged.mode && !this.modeHeld;
    this.resetHeld = merged.reset;
    this.modeHeld = merged.mode;
    return { ...merged, reset: resetEdge, mode: modeEdge };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

function isBound(code: string): boolean {
  return Object.values(inputConfig.keys).some((codes) => (codes as readonly string[]).includes(code));
}
