import { describe, expect, it } from "vitest";
import { accuracy, createStats } from "./stats";

describe("stats", () => {
  it("starts at zero", () => {
    expect(createStats()).toEqual({ shotsFired: 0, directHits: 0, targetsDown: 0 });
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
