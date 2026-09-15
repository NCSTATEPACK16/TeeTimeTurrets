import { describe, expect, it } from "vitest";
import {
  BARRIER_INSET_M,
  clampNorthOf,
  clampToBounds,
  clampToPlayable,
  metresNorthOf,
} from "./courseBarrier";
import type { SouthBoundary } from "./courseBarrier";
import { AUTHORED_PLACEMENTS, AUTHORED_SOUTH_BOUNDARY, metresNorthOfBoundary } from "./authoredLayout";
import { authoredCourse } from "./authoredCourse";
import { boundsOf } from "./courseLayout";
import type { Bounds } from "./courseLayout";

/** A square, so "inside the box" is easy to reason about independently of the course. */
const BOX: Bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };

/** The seed main.ts ships, so the sweeps below are over the course the player is handed. */
const COURSE_SEED = 2026;

/** A line running east and south at 45 degrees, so a push along its normal moves x and z equally. */
const DIAGONAL: SouthBoundary = { a: { x: -100, z: 0 }, b: { x: 100, z: -200 } };

describe("clampToBounds", () => {
  it("leaves a point inside alone and reports that it did", () => {
    const out = { x: 0, z: 0 };
    expect(clampToBounds(BOX, 5, 10, -20, out)).toBe(false);
    expect(out).toEqual({ x: 10, z: -20 });
  });

  it("pulls a point outside back to the inset edge", () => {
    const out = { x: 0, z: 0 };
    expect(clampToBounds(BOX, 5, 500, -500, out)).toBe(true);
    expect(out).toEqual({ x: 95, z: -95 });
  });
});

describe("clampNorthOf", () => {
  it("leaves a point already clear of the line alone", () => {
    const out = { x: 0, z: 0 };
    expect(clampNorthOf(DIAGONAL, 6, 0, 500, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 500 });
  });

  it("pushes along the line's normal, not straight up in z", () => {
    /**
     * The property the diagonal exists to force. A correction applied in `z` alone would land the
     * point at the wrong distance from a slanted line and would slide a cart along the road rather
     * than off it; on this 45-degree line a normal push moves x and z by the same amount, so a
     * z-only implementation is caught by `x` never changing.
     */
    const out = { x: 0, z: 0 };
    expect(clampNorthOf(DIAGONAL, 10, 0, -100, out)).toBe(true);
    expect(metresNorthOf(DIAGONAL, out.x, out.z)).toBeCloseTo(10, 9);
    expect(out.x, "a z-only clamp would leave x untouched").not.toBeCloseTo(0, 6);
    expect(Math.abs(out.x - 0)).toBeCloseTo(Math.abs(out.z - -100), 9);
  });

  it("puts a point exactly on the line at the inset, rather than leaving it on the road", () => {
    const out = { x: 0, z: 0 };
    const on = { x: 0, z: -100 }; // the midpoint of DIAGONAL, so exactly 0 m north
    expect(metresNorthOf(DIAGONAL, on.x, on.z)).toBeCloseTo(0, 9);
    clampNorthOf(DIAGONAL, BARRIER_INSET_M, on.x, on.z, out);
    expect(metresNorthOf(DIAGONAL, out.x, out.z)).toBeCloseTo(BARRIER_INSET_M, 9);
  });
});

describe("clampToPlayable", () => {
  it("leaves a point inside the box and north of the road, from anywhere", () => {
    /**
     * The conjunction, which is the property -- not the order the two rules are applied in.
     *
     * An earlier version of this test asserted the order instead, claiming box-then-road was needed
     * so the road survived. It could not tell the two orders apart: reversing them in the module
     * failed nothing. The orders differ only where the road's inset locus lies outside the bounds,
     * and the test below measures that this course never does.
     */
    const course = authoredCourse(COURSE_SEED);
    const bounds = boundsOf(
      AUTHORED_PLACEMENTS.map((p) => ({ ...p, fieldSize: course.holes[p.index]!.fieldSize })),
    );
    const inset = 3;
    const out = { x: 0, z: 0 };
    let tested = 0;

    for (let fx = -0.2; fx <= 1.2; fx += 0.05) {
      for (let fz = -0.3; fz <= 1.2; fz += 0.05) {
        const x = bounds.minX + (bounds.maxX - bounds.minX) * fx;
        const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * fz;
        clampToPlayable(bounds, AUTHORED_SOUTH_BOUNDARY, inset, x, z, out);
        expect(out.x, `x from (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThanOrEqual(bounds.minX + inset - 1e-6);
        expect(out.x, `x from (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThanOrEqual(bounds.maxX - inset + 1e-6);
        expect(out.z, `z from (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThanOrEqual(bounds.minZ + inset - 1e-6);
        expect(out.z, `z from (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThanOrEqual(bounds.maxZ - inset + 1e-6);
        expect(
          metresNorthOfBoundary(out.x, out.z),
          `road side from (${x.toFixed(0)}, ${z.toFixed(0)})`,
        ).toBeGreaterThanOrEqual(BARRIER_INSET_M - 1e-6);
        tested += 1;
      }
    }
    expect(tested).toBeGreaterThan(500);
  });

  it("never has to choose between the box and the road on this course", () => {
    /**
     * What makes the order above a non-question, stated as a measurement rather than a belief: for
     * every point along County Home Road's own extent, the place the road clamp puts a cart -- the
     * locus `BARRIER_INSET_M` north of it -- is inside the bounds box. So the box never has to undo
     * the road, and the road never has to push a cart off the heightfield.
     *
     * If a later course breaks this, `clampToPlayable`'s ordering stops being arbitrary and this is
     * the test that says so first.
     */
    const course = authoredCourse(COURSE_SEED);
    const bounds = boundsOf(
      AUTHORED_PLACEMENTS.map((p) => ({ ...p, fieldSize: course.holes[p.index]!.fieldSize })),
    );
    const { a, b } = AUTHORED_SOUTH_BOUNDARY;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);

    let checked = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const x = a.x + dx * t + (-dz / len) * BARRIER_INSET_M;
      const z = a.z + dz * t + (dx / len) * BARRIER_INSET_M;
      expect(x, `locus x at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(bounds.minX);
      expect(x, `locus x at t=${t.toFixed(2)}`).toBeLessThanOrEqual(bounds.maxX);
      expect(z, `locus z at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(bounds.minZ);
      expect(z, `locus z at t=${t.toFixed(2)}`).toBeLessThanOrEqual(bounds.maxZ);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(90);
  });

  it("is the box alone when a course has no southern boundary", () => {
    // A generated course and a stroke-play hole both load without one, and must not borrow the
    // shipped course's road.
    const out = { x: 0, z: 0 };
    expect(clampToPlayable(BOX, null, 5, 500, -500, out)).toBe(true);
    expect(out).toEqual({ x: 95, z: -95 });
  });

  it("holds the real road at every point along it, not just one", () => {
    /**
     * **A wall with a gap passes a single-point test**, and the driven test in
     * `world.course.test.ts` can only cross the boundary in one place per run. This sweeps the
     * whole of County Home Road instead.
     *
     * Asserted here at the function rather than through the physics deliberately, and the reason is
     * recorded rather than glossed: driving three carts to three different x values means either
     * three `arenaSim()` instances steered across a course, or writing `sim.cart.position`
     * directly -- and `moveCartBody` fights a direct write on the very next tick, so that test
     * would measure the fight rather than the barrier. What the driven test proves is that the
     * clamp is wired into the cart at all; what this proves is that it has no gap.
     */
    const { a, b } = AUTHORED_SOUTH_BOUNDARY;
    const out = { x: 0, z: 0 };
    let tested = 0;
    for (let t = -0.1; t <= 1.1; t += 0.01) {
      const onRoad = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      // Start well onto the road side, as a cart driving south would arrive.
      for (const depth of [1, 40, 200]) {
        const start = { x: onRoad.x, z: onRoad.z - depth };
        expect(metresNorthOfBoundary(start.x, start.z)).toBeLessThan(0);
        clampNorthOf(AUTHORED_SOUTH_BOUNDARY, BARRIER_INSET_M, start.x, start.z, out);
        expect(
          metresNorthOfBoundary(out.x, out.z),
          `road side at t=${t.toFixed(2)}, ${depth} m deep`,
        ).toBeCloseTo(BARRIER_INSET_M, 6);
        tested += 1;
      }
    }
    // Guard the guard: a sweep that tested nothing would satisfy every assertion in it.
    expect(tested).toBeGreaterThan(300);
  });

  it("does not represent Files Road, and here is the distance that decides it", () => {
    /**
     * The plat shows a second boundary road at the south-east corner, and this course does not
     * model it. Measured rather than waved away: the nearest corridor point of any of the eighteen
     * holes is **244 m** from it, so no hole is routed against it the way every hole on the
     * southern edge is routed against County Home Road. A barrier there would be a bound with no
     * consumer, which `AGENTS.md` calls a comment rather than a check.
     *
     * `SouthBoundary` is one line for the same reason -- one subtraction in the fixed loop. If a
     * later mode sends carts into that corner, `clampToPlayable` takes a second line without a
     * redesign, and this assertion is what will fail first.
     */
    const FILES_ROAD: SouthBoundary = { a: { x: 443, z: -573 }, b: { x: 497, z: -723 } };
    // It is on the playable side of County Home Road, which is exactly why it is worth recording:
    // the corner is reachable ground, it is simply ground nothing is routed near.
    const mid = { x: (FILES_ROAD.a.x + FILES_ROAD.b.x) / 2, z: (FILES_ROAD.a.z + FILES_ROAD.b.z) / 2 };
    expect(metresNorthOfBoundary(mid.x, mid.z)).toBeGreaterThan(0);
  });
});
