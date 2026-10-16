import { describe, expect, it } from "vitest";
import { clamp, clamp01, segmentDistanceSq, wrapAngle } from "./vec";

describe("clamp", () => {
  it("passes a value inside the range through and pins one outside it to the nearer end", () => {
    expect(clamp(0.25, -1, 2)).toBe(0.25);
    expect(clamp(-3, -1, 2)).toBe(-1);
    expect(clamp(7, -1, 2)).toBe(2);
  });

  it("clamp01 is clamp to [0, 1]", () => {
    for (const v of [-0.5, 0, 0.3, 1, 4]) expect(clamp01(v)).toBe(clamp(v, 0, 1));
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(4)).toBe(1);
  });
});

describe("wrapAngle", () => {
  it("folds an angle into [-PI, PI] the short way round", () => {
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 12);
    // Just past PI is just short of -PI: a bot turning to it turns the other way.
    expect(wrapAngle(Math.PI + 0.25)).toBeCloseTo(-Math.PI + 0.25, 12);
    expect(wrapAngle(-Math.PI - 0.25)).toBeCloseTo(Math.PI - 0.25, 12);
  });
});

describe("segmentDistanceSq", () => {
  // The segment (0,0) -> (10,0).
  it("measures square to the perpendicular foot inside the segment", () => {
    expect(segmentDistanceSq(4, 3, 0, 0, 10, 0)).toBe(9);
  });

  it("measures to the nearer end beyond either end", () => {
    expect(segmentDistanceSq(-3, 4, 0, 0, 10, 0)).toBe(25);
    expect(segmentDistanceSq(13, 4, 0, 0, 10, 0)).toBe(25);
  });

  it("treats a zero-length segment as its point, rather than dividing by zero", () => {
    expect(segmentDistanceSq(3, 4, 1, 1, 1, 1)).toBe(13);
  });
});
