import { describe, expect, it } from "vitest";
import { CHASE_BASE_FOV, CHASE_DISTANCE, CHASE_FOV_KICK, CHASE_FOV_FULL_SPEED, CHASE_POSITION_LERP, chaseFov, chasePose, chaseSmoothing, clearTerrain } from "./chaseCamera";
import type { CartTransform } from "../sim/world";

function cartAt(heading: number, turretYaw: number): CartTransform {
  return { position: { x: 0, y: 0, z: 0 }, heading, turretYaw };
}

describe("chase camera", () => {
  it("sits behind the turret, not the chassis, so the player sees what they are aiming at", () => {
    // Chassis facing +X, turret swung round to +Z.
    const eye = { x: 0, y: 0, z: 0 };
    const look = { x: 0, y: 0, z: 0 };
    chasePose(cartAt(0, Math.PI / 2), eye, look);
    expect(eye.x).toBeCloseTo(0, 9);
    expect(eye.z).toBeCloseTo(-CHASE_DISTANCE, 9);
    expect(look.z).toBeGreaterThan(0);
  });

  it("closes the same distance in two half-length frames as in one full frame", () => {
    // Per-frame lerp factors make a 144 Hz monitor's camera three times as stiff as a 48 Hz one.
    const oneFrame = chaseSmoothing(CHASE_POSITION_LERP, 1 / 60);
    const half = chaseSmoothing(CHASE_POSITION_LERP, 1 / 120);
    const twoHalves = 1 - (1 - half) * (1 - half);
    expect(twoHalves).toBeCloseTo(oneFrame, 9);
  });

  it("keeps the 60 Hz feel it was tuned at", () => {
    expect(chaseSmoothing(CHASE_POSITION_LERP, 1 / 60)).toBeCloseTo(CHASE_POSITION_LERP, 9);
  });

  it("does not move at all in a zero-length frame", () => {
    expect(chaseSmoothing(CHASE_POSITION_LERP, 0)).toBe(0);
  });
});

describe("speed FOV", () => {
  it("widens with speed, up to a ceiling, and not at all when stopped or reversing", () => {
    expect(chaseFov(0)).toBe(CHASE_BASE_FOV);
    expect(chaseFov(-5)).toBe(CHASE_BASE_FOV);
    expect(chaseFov(CHASE_FOV_FULL_SPEED / 2)).toBeCloseTo(CHASE_BASE_FOV + CHASE_FOV_KICK / 2, 9);
    expect(chaseFov(CHASE_FOV_FULL_SPEED * 3)).toBe(CHASE_BASE_FOV + CHASE_FOV_KICK);
  });
});

describe("clearTerrain", () => {
  const eye = (): { x: number; y: number; z: number } => ({ x: -6.5, y: 3.6, z: 0 });
  const look = { x: 8, y: 0.7, z: 0 };

  it("leaves the eye alone over flat ground", () => {
    const e = eye();
    clearTerrain(e, look, () => 0, 0.8);
    expect(e).toEqual(eye());
  });

  it("lifts the eye so the sight line clears a rise between it and the cart", () => {
    // A bank 3 m high just behind the cart, under the sight line.
    const bank = (x: number): number => (x > -3 && x < -1 ? 3 : 0);
    const e = eye();
    clearTerrain(e, look, bank, 0.8);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const x = look.x + (e.x - look.x) * t;
      const y = look.y + (e.y - look.y) * t;
      expect(y).toBeGreaterThanOrEqual(bank(x) + 0.8 - 1e-6);
    }
  });

  it("lifts the eye over ground rising behind the cart", () => {
    const e = eye();
    clearTerrain(e, look, (x) => (x < -5 ? 4 : 0), 0.8);
    expect(e.y).toBeGreaterThanOrEqual(4.8);
  });
});
