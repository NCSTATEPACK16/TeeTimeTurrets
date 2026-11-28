import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import {
  AIM_EXPONENT,
  AIM_PEAK_RAD_S,
  PAD,
  PAD_AXES,
  PAD_BUTTONS,
  STICK_DEADZONE,
  intentFromPad,
  padActive,
  padMenuEdges,
} from "./gamepadMapping";
import type { PadFrame } from "./gamepadMapping";

/**
 * The gamepad binding table (Stage 4b, spec §2.1), as a pure function of the pad's state, the way
 * `mapping.test.ts` holds the keys. Indices are the `standard` mapping's positions; on the 8BitDo
 * SN30 Pro the bottom button reads B and the top one X.
 */

function pad(options: { held?: number[]; wasHeld?: number[]; axes?: number[] } = {}): PadFrame {
  const buttons = new Uint8Array(PAD_BUTTONS);
  const prev = new Uint8Array(PAD_BUTTONS);
  for (const i of options.held ?? []) buttons[i] = 1;
  for (const i of options.wasHeld ?? []) prev[i] = 1;
  const axes = new Float64Array(PAD_AXES);
  (options.axes ?? []).forEach((v, i) => (axes[i] = v));
  return { buttons, prev, axes };
}

const TICK = 1 / 60;

describe("the sticks", () => {
  it("reads a resting stick as exactly 0, in any direction inside the deadzone", () => {
    // Radial: 0.12 on both axes is 0.17 from centre, inside 0.18, though each axis alone is small.
    for (const [x, y] of [
      [0.12, 0.12],
      [-0.17, 0],
      [0, 0.179],
      [0.05, -0.1],
    ] as const) {
      const intent = intentFromPad(pad({ axes: [x, y, x, y] }), ClubType.Putter);
      // `toBe(0)` and not `toBeCloseTo`: the spool restarts on any non-zero, so a near-0 is a bug.
      expect(Object.is(intent.throttle, 0) || Object.is(intent.throttle, -0)).toBe(true);
      expect(intent.throttle === 0 && intent.steer === 0 && intent.aimDelta === 0).toBe(true);
    }
  });

  it("drives forward with the left stick pushed up, and steers right with it pushed right", () => {
    const up = intentFromPad(pad({ axes: [0, -1] }), ClubType.Putter);
    expect(up.throttle).toBe(1);
    expect(up.steer).toBe(0);
    const right = intentFromPad(pad({ axes: [1, 0] }), ClubType.Putter);
    expect(right.steer).toBe(1);
    expect(right.throttle).toBe(0);
  });

  it("starts from 0 at the deadzone's edge rather than jumping to it", () => {
    const justOut = intentFromPad(pad({ axes: [0, -(STICK_DEADZONE + 0.01)] }), ClubType.Putter);
    expect(justOut.throttle).toBeGreaterThan(0);
    expect(justOut.throttle).toBeLessThan(0.02);
  });

  it("turns the turret at the peak rate at full right stick, and on a squared curve below it", () => {
    const full = intentFromPad(pad({ axes: [0, 0, 1, 0] }), ClubType.Putter);
    expect(full.aimDelta).toBeCloseTo(AIM_PEAK_RAD_S * TICK, 12);
    const left = intentFromPad(pad({ axes: [0, 0, -1, 0] }), ClubType.Putter);
    expect(left.aimDelta).toBeCloseTo(-AIM_PEAK_RAD_S * TICK, 12);
    // Halfway between the deadzone and the edge is a quarter of the peak, not half: the curve.
    const half = STICK_DEADZONE + (1 - STICK_DEADZONE) / 2;
    const mid = intentFromPad(pad({ axes: [0, 0, half, 0] }), ClubType.Putter);
    expect(AIM_EXPONENT).toBe(2);
    expect(mid.aimDelta).toBeCloseTo(0.25 * AIM_PEAK_RAD_S * TICK, 12);
  });
});

describe("the buttons", () => {
  it("fires on R2 and brakes on L2 while held", () => {
    const intent = intentFromPad(pad({ held: [PAD.r2, PAD.l2], wasHeld: [PAD.r2, PAD.l2] }), ClubType.Putter);
    expect(intent.fire).toBe(true);
    expect(intent.brake).toBe(true);
  });

  it("cancels a charge and calls a mortar on the press, not the hold", () => {
    const press = intentFromPad(pad({ held: [PAD.bottom, PAD.top] }), ClubType.Putter);
    expect(press.cancelCharge).toBe(true);
    expect(press.callMortar).toBe(true);
    const hold = intentFromPad(pad({ held: [PAD.bottom, PAD.top], wasHeld: [PAD.bottom, PAD.top] }), ClubType.Putter);
    expect(hold.cancelCharge).toBe(false);
    expect(hold.callMortar).toBe(false);
  });

  it("picks a club directly on the D-pad, and steps through them on L1/R1, wrapping", () => {
    expect(intentFromPad(pad({ held: [PAD.dleft] }), ClubType.Driver).selectClub).toBe(ClubType.Putter);
    expect(intentFromPad(pad({ held: [PAD.up] }), ClubType.Putter).selectClub).toBe(ClubType.Iron);
    expect(intentFromPad(pad({ held: [PAD.dright] }), ClubType.Putter).selectClub).toBe(ClubType.Driver);
    expect(intentFromPad(pad({ held: [PAD.r1] }), ClubType.Putter).selectClub).toBe(ClubType.Iron);
    expect(intentFromPad(pad({ held: [PAD.r1] }), ClubType.Driver).selectClub).toBe(ClubType.Putter);
    expect(intentFromPad(pad({ held: [PAD.l1] }), ClubType.Putter).selectClub).toBe(ClubType.Driver);
    expect(intentFromPad(pad({ held: [PAD.r1], wasHeld: [PAD.r1] }), ClubType.Putter).selectClub).toBe(null);
  });

  it("gives the match screen Start, Select and the horn as presses", () => {
    const edges = { pause: false, map: false, horn: false };
    expect(padMenuEdges(pad({ held: [PAD.start, PAD.select, PAD.left] }), edges)).toEqual({
      pause: true,
      map: true,
      horn: true,
    });
    expect(padMenuEdges(pad({ held: [PAD.start], wasHeld: [PAD.start] }), edges).pause).toBe(false);
  });

  it("counts a pad at rest as idle, so it never takes the active input from the keyboard", () => {
    expect(padActive(pad({ axes: [0.1, -0.1, 0.05, 0] }))).toBe(false);
    expect(padActive(pad({ held: [PAD.r2] }))).toBe(true);
    expect(padActive(pad({ axes: [0, -0.5] }))).toBe(true);
  });
});
