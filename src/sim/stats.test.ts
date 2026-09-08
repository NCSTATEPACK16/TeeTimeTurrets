import { describe, expect, it } from "vitest";
import { accuracy, createStats } from "./stats";

describe("stats", () => {
  it("starts at zero", () => {
    // All four of image 13's tiles, including the longest drive Phase 1.75 added: the scorecard
    // reads every one of them, and three still being zero in stroke play is not a reason to omit
    // one from the shape.
    expect(createStats()).toEqual({
      shotsFired: 0,
      directHits: 0,
      targetsDown: 0,
      longestDriveM: 0,
    });
  });

  it("reports zero accuracy before a shot is fired rather than dividing by zero", () => {
    expect(accuracy(createStats())).toBe(0);
  });

  it("reports hits over shots", () => {
    const s = createStats();
    s.shotsFired = 4;
    s.directHits = 1;
    expect(accuracy(s)).toBeCloseTo(0.25, 9);
  });
});
