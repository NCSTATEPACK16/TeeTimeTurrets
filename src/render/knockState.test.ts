import { describe, expect, it } from "vitest";
import { KnockState } from "./knockState";

describe("knockable props", () => {
  it("topples a prop a fast cart drives through, ignores a slow one, and lays it down along the hit", () => {
    const state = new KnockState([
      { x: 0, z: 0, yaw: 0 },
      { x: 10, z: 0, yaw: 0 },
    ]);
    expect(state.pass(10, 0.5, 2, 0)).toBe(0); // a crawl past prop 1
    expect(state.isKnocked(1)).toBe(false);

    const knocked: number[] = [];
    expect(state.pass(0.5, 0, 9, 0, (i) => knocked.push(i))).toBe(1);
    expect(knocked).toEqual([0]);
    expect(state.pass(0.5, 0, 9, 0)).toBe(0); // already down

    for (let i = 0; i < 180; i++) state.update(1 / 60);
    expect(state.tilt[0]).toBeCloseTo(Math.PI / 2, 5); // lying on its side
    expect(state.slideX[0]).toBeGreaterThan(0.3); // slid the way the cart was going
    expect(state.fallX[0]).toBe(1);
    expect(state.update(1 / 60)).toBe(false); // at rest: no more uploads
    expect(state.tilt[1]).toBe(0);
  });
});
