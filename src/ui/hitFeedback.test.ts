import { describe, expect, it } from "vitest";
import {
  DAMAGE_INDICATOR_S,
  DamageIndicators,
  damageScreenAngle,
  lowHpIntensity,
  markerLabel,
} from "./hitFeedback";
import { SCORE_PER_DAMAGE, SCORE_PER_KILL } from "../sim/scoring";

const deg = (r: number): number => Math.round((r * 180) / Math.PI);

describe("damageScreenAngle", () => {
  // Yaw 0 looks down +x. The chase camera sits behind the turret, so +z is on the right.
  it("puts a shooter dead ahead at the top of the screen", () => {
    expect(deg(damageScreenAngle(10, 0, 0, 0, 0))).toBe(0);
  });

  it("puts a shooter on +z to the right when looking down +x, and behind at the bottom", () => {
    expect(deg(damageScreenAngle(0, 10, 0, 0, 0))).toBe(90);
    expect(Math.abs(deg(damageScreenAngle(-10, 0, 0, 0, 0)))).toBe(180);
    expect(deg(damageScreenAngle(0, -10, 0, 0, 0))).toBe(-90);
  });

  it("turns with the view: facing +z, a shooter on +z is ahead", () => {
    expect(deg(damageScreenAngle(0, 10, 0, 0, Math.PI / 2))).toBe(0);
    expect(deg(damageScreenAngle(10, 0, 0, 0, Math.PI / 2))).toBe(-90);
  });

  it("is measured from the player, not the origin", () => {
    expect(deg(damageScreenAngle(105, 50, 100, 50, 0))).toBe(0);
  });
});

describe("DamageIndicators", () => {
  it(`fades each flash over ${DAMAGE_INDICATOR_S} s and drops it after`, () => {
    const ind = new DamageIndicators();
    ind.add(1);
    expect(ind.active).toHaveLength(1);
    expect(ind.active[0]!.opacity).toBe(1);
    ind.update(DAMAGE_INDICATOR_S / 2);
    expect(ind.active[0]!.opacity).toBeCloseTo(0.5);
    ind.update(DAMAGE_INDICATOR_S / 2 + 0.01);
    expect(ind.active).toHaveLength(0);
  });

  it("refreshes a flash from the same direction instead of stacking a second", () => {
    const ind = new DamageIndicators();
    ind.add(1);
    ind.update(0.5);
    ind.add(1.05);
    expect(ind.active).toHaveLength(1);
    expect(ind.active[0]!.opacity).toBe(1);
  });
});

describe("lowHpIntensity", () => {
  it("is off at half health and above, and grows as health falls", () => {
    expect(lowHpIntensity(8, 8)).toBe(0);
    expect(lowHpIntensity(4, 8)).toBe(0);
    const three = lowHpIntensity(3, 8);
    const one = lowHpIntensity(1, 8);
    expect(three).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(three);
    expect(one).toBeLessThanOrEqual(1);
  });

  it("is off while dead, when the death screen says it instead", () => {
    expect(lowHpIntensity(0, 8)).toBe(0);
  });
});

describe("markerLabel", () => {
  it("shows what a hit is actually worth, not a fixed +50", () => {
    expect(markerLabel("hit", 1)).toBe(`+${SCORE_PER_DAMAGE}`);
    expect(markerLabel("hit", 2)).toBe(`+${2 * SCORE_PER_DAMAGE}`);
  });

  it("shows a kill's worth with the callout", () => {
    expect(markerLabel("kill", 0)).toBe(`ENEMY DOWN +${SCORE_PER_KILL}`);
  });
});
