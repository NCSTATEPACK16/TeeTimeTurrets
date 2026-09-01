import { describe, expect, it } from "vitest";
import { legacyHoleSpec } from "./course";

describe("legacyHoleSpec", () => {
  it("reproduces the constants terrain.ts hardcodes today", () => {
    const spec = legacyHoleSpec();
    // FIELD_SIZE / NROWS / NCOLS in src/sim/terrain.ts before the refactor.
    expect(spec.fieldSize).toBe(160);
    expect(spec.cells).toBe(160);
    // TEE_XZ = { x: -FIELD_SIZE / 2 + TEE_INSET, z: 0 } with TEE_INSET = 12.
    expect(spec.tee).toEqual({ x: -68, z: 0 });
    // CUP_XZ = { x: FIELD_SIZE / 2 - 25, z: 8 }.
    expect(spec.cup).toEqual({ x: 55, z: 8 });
    // WATER_LEVEL.
    expect(spec.waterLevel).toBe(-0.72);
    expect(spec.index).toBe(0);
  });

  it("holds a cell size near 1 m, which the ball radius depends on", () => {
    const spec = legacyHoleSpec();
    expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
  });

  it("has a corridor running tee first, cup last, with at least three points", () => {
    const spec = legacyHoleSpec();
    expect(spec.control.length).toBeGreaterThanOrEqual(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(legacyHoleSpec()).not.toBe(legacyHoleSpec());
    expect(legacyHoleSpec()).toEqual(legacyHoleSpec());
  });
});
