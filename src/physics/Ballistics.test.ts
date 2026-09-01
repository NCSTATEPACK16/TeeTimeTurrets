import { describe, expect, it } from "vitest";
import {
  CLUB_STATS,
  ClubType,
  applyAimSpread,
  chargeFraction,
  computeDragForce,
  computeLaunchVelocity,
} from "./Ballistics";

/**
 * These lock in the contracts the rest of the codebase assumes rather than re-deriving the
 * arithmetic: the yaw-0-is-+X convention (shared with terrain.ts and world.ts), the fact that
 * loft splits a club's speed instead of adding to it, and that spread is deterministic given
 * its injected RNG. Each is something a plausible future edit could silently break.
 */

const EPSILON = 1e-9;

describe("chargeFraction", () => {
  it("reaches exactly 1 at the club's charge time", () => {
    expect(chargeFraction(CLUB_STATS[ClubType.Driver].chargeSeconds, ClubType.Driver)).toBe(1);
  });

  it("clamps rather than overshooting when the button is held past full charge", () => {
    expect(chargeFraction(99, ClubType.Putter)).toBe(1);
  });

  it("clamps a negative hold to zero", () => {
    expect(chargeFraction(-1, ClubType.Iron)).toBe(0);
  });

  it("scales per club, so the same hold charges a putter more than a driver", () => {
    expect(chargeFraction(0.5, ClubType.Putter)).toBeGreaterThan(chargeFraction(0.5, ClubType.Driver));
  });
});

describe("computeLaunchVelocity", () => {
  it("aims down world +X at yaw 0", () => {
    const v = computeLaunchVelocity(ClubType.Iron, 1, 0);
    expect(v.x).toBeGreaterThan(0);
    expect(Math.abs(v.z)).toBeLessThan(EPSILON);
  });

  it("aims down world +Z at yaw pi/2", () => {
    const v = computeLaunchVelocity(ClubType.Iron, 1, Math.PI / 2);
    expect(Math.abs(v.x)).toBeLessThan(EPSILON);
    expect(v.z).toBeGreaterThan(0);
  });

  it("treats loft as a split of club speed, not an addition to it", () => {
    // Regression guard: computing horizontal as `speed` and vertical as `sin(loft) * speed`
    // would also pass a "ball goes up and forward" eyeball check, but launches the driver
    // above its own maxSpeed.
    const stats = CLUB_STATS[ClubType.Driver];
    const v = computeLaunchVelocity(ClubType.Driver, 1, 0.7);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(stats.maxSpeed, 9);
  });

  it("launches at minSpeed at zero charge", () => {
    const v = computeLaunchVelocity(ClubType.Putter, 0, 0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(CLUB_STATS[ClubType.Putter].minSpeed, 9);
  });

  it("gives the putter a flatter trajectory than the iron at equal charge", () => {
    const putt = computeLaunchVelocity(ClubType.Putter, 1, 0);
    const iron = computeLaunchVelocity(ClubType.Iron, 1, 0);
    expect(putt.y / Math.hypot(putt.x, putt.z)).toBeLessThan(iron.y / Math.hypot(iron.x, iron.z));
  });

  it("clamps charge above 1 instead of exceeding maxSpeed", () => {
    const over = computeLaunchVelocity(ClubType.Iron, 5, 0);
    const full = computeLaunchVelocity(ClubType.Iron, 1, 0);
    expect(Math.hypot(over.x, over.y, over.z)).toBeCloseTo(Math.hypot(full.x, full.y, full.z), 9);
  });
});

describe("applyAimSpread", () => {
  it("leaves aim untouched at the centre of the cone", () => {
    expect(applyAimSpread(0.4, ClubType.Driver, () => 0.5)).toBeCloseTo(0.4, 12);
  });

  it("displaces by the full cone half-angle at the extremes of the RNG range", () => {
    const halfAngle = (CLUB_STATS[ClubType.Driver].spreadDeg * Math.PI) / 180;
    expect(applyAimSpread(0, ClubType.Driver, () => 1)).toBeCloseTo(halfAngle, 12);
    expect(applyAimSpread(0, ClubType.Driver, () => 0)).toBeCloseTo(-halfAngle, 12);
  });

  it("is deterministic given the same injected RNG sequence", () => {
    // The AGENTS.md no-Math.random rule is only enforceable if spread depends solely on the
    // injected function. Two identical sequences must produce identical aim.
    const sequence = (): (() => number) => {
      const values = [0.13, 0.87, 0.42];
      let i = 0;
      return () => values[i++ % values.length]!;
    };
    const first = [0, 1, 2].map(() => applyAimSpread(0.2, ClubType.Iron, sequence()));
    const second = [0, 1, 2].map(() => applyAimSpread(0.2, ClubType.Iron, sequence()));
    expect(first).toEqual(second);
  });

  it("gives the putter a tighter cone than the driver", () => {
    const putt = applyAimSpread(0, ClubType.Putter, () => 1);
    const drive = applyAimSpread(0, ClubType.Driver, () => 1);
    expect(Math.abs(putt)).toBeLessThan(Math.abs(drive));
  });
});

describe("computeDragForce", () => {
  const params = { airDensity: 1.2, dragCoefficient: 0.25, crossSectionAreaM2: Math.PI * 0.021 ** 2 };

  it("returns no force for a ball at rest", () => {
    expect(computeDragForce({ x: 0, y: 0, z: 0 }, params)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("opposes the direction of travel on every axis", () => {
    const drag = computeDragForce({ x: 30, y: -4, z: 12 }, params);
    expect(drag.x).toBeLessThan(0);
    expect(drag.y).toBeGreaterThan(0);
    expect(drag.z).toBeLessThan(0);
  });

  it("grows quadratically with speed", () => {
    const slow = computeDragForce({ x: 10, y: 0, z: 0 }, params);
    const fast = computeDragForce({ x: 20, y: 0, z: 0 }, params);
    expect(Math.abs(fast.x) / Math.abs(slow.x)).toBeCloseTo(4, 6);
  });
});
