import { describe, expect, it } from "vitest";
import { ASSIST_CONE_RAD, ASSIST_MIN_SCALE, ASSIST_RANGE_M, aimAssistScale } from "./aimAssist";
import type { AssistTarget } from "./aimAssist";

/** Pad aim assist (Stage 4b, spec §2.2): a slowdown measured from the turret's yaw. */

const at = (bearing: number, distance: number, eligible = true): AssistTarget => ({
  x: Math.cos(bearing) * distance,
  z: Math.sin(bearing) * distance,
  eligible,
});

describe("aim assist", () => {
  it("slows the stick most dead on an enemy, and not at all outside the cone", () => {
    expect(aimAssistScale(0, 0, 0, [at(0, 30)], 1)).toBeCloseTo(ASSIST_MIN_SCALE, 12);
    expect(aimAssistScale(0, 0, 0, [at(ASSIST_CONE_RAD / 2, 30)], 1)).toBeCloseTo((1 + ASSIST_MIN_SCALE) / 2, 12);
    expect(aimAssistScale(0, 0, 0, [at(ASSIST_CONE_RAD + 0.01, 30)], 1)).toBe(1);
  });

  it("measures from the turret's yaw, whichever way the turret points", () => {
    // An enemy straight ahead of a turret turned to face +Z, and across the ±π seam.
    expect(aimAssistScale(Math.PI / 2, 0, 0, [at(Math.PI / 2, 30)], 1)).toBeCloseTo(ASSIST_MIN_SCALE, 12);
    expect(aimAssistScale(Math.PI - 0.01, 0, 0, [at(-Math.PI + 0.01, 30)], 1)).toBeLessThan(1);
    // The turret faces away: nothing.
    expect(aimAssistScale(Math.PI, 0, 0, [at(0, 30)], 1)).toBe(1);
  });

  it("ignores an ineligible cart, one out of range, and targets past the count", () => {
    expect(aimAssistScale(0, 0, 0, [at(0, 30, false)], 1)).toBe(1);
    expect(aimAssistScale(0, 0, 0, [at(0, ASSIST_RANGE_M + 1)], 1)).toBe(1);
    expect(aimAssistScale(0, 0, 0, [at(1, 30), at(0, 30)], 1)).toBe(1);
  });
});
