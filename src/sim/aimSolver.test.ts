import { describe, expect, it } from "vitest";
import { SOLVER_CONSTANTS } from "./aimSolver";
import { FIXED_DT, GRAVITY } from "./world";

describe("aimSolver", () => {
  it("integrates with the world's own gravity and step", () => {
    expect(SOLVER_CONSTANTS.GRAVITY).toBe(GRAVITY);
    expect(SOLVER_CONSTANTS.DT).toBe(FIXED_DT);
  });
});
