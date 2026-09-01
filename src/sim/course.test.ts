import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";

describe("fixedHoleSpec", () => {
  it("holds a cell size near 1 m, which the ball radius depends on", () => {
    const spec = fixedHoleSpec();
    expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
  });

  it("has a corridor running tee first, cup last, with a dog-leg between", () => {
    const spec = fixedHoleSpec();
    expect(spec.control.length).toBeGreaterThanOrEqual(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(fixedHoleSpec()).not.toBe(fixedHoleSpec());
    expect(fixedHoleSpec()).toEqual(fixedHoleSpec());
  });
});
