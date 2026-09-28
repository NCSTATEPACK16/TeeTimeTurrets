import { describe, expect, it } from "vitest";
import { CartSuspension, fitCartGround } from "./cartSuspension";

const flat = (): number => 0;

describe("fitCartGround", () => {
  it("is level on level ground", () => {
    const out = { pitch: 1, roll: 1, height: 1 };
    fitCartGround(flat, 10, 20, 0.7, out);
    expect(out.pitch).toBeCloseTo(0, 9);
    expect(out.roll).toBeCloseTo(0, 9);
    expect(out.height).toBeCloseTo(0, 9);
  });

  it("pitches the nose up a rise ahead and down one behind", () => {
    const rise = (x: number): number => 0.2 * x;
    const out = { pitch: 0, roll: 0, height: 0 };
    fitCartGround(rise, 0, 0, 0, out);
    expect(out.pitch).toBeCloseTo(Math.atan(0.2), 6);
    expect(out.roll).toBeCloseTo(0, 6);
    fitCartGround(rise, 0, 0, Math.PI, out);
    expect(out.pitch).toBeCloseTo(-Math.atan(0.2), 6);
  });

  it("rolls toward the low side on a cross-slope", () => {
    // Heading +X, ground rising toward -Z: the cart's local +X side (world -Z) is the high one.
    const cross = (_x: number, z: number): number => -0.1 * z;
    const out = { pitch: 0, roll: 0, height: 0 };
    fitCartGround(cross, 0, 0, 0, out);
    expect(out.pitch).toBeCloseTo(0, 6);
    expect(out.roll).toBeCloseTo(Math.atan(0.1), 6);
  });
});

describe("CartSuspension", () => {
  const rise = (x: number): number => 0.25 * x;

  it("settles on the fitted pitch at about 2 Hz without overshooting", () => {
    const s = new CartSuspension();
    const target = Math.atan(0.25);
    let peak = 0;
    let at90 = Infinity;
    for (let i = 0; i < 120; i++) {
      s.update(1 / 60, 0, 0, 0, 0, rise);
      peak = Math.max(peak, s.pitch);
      if (at90 === Infinity && s.pitch >= target * 0.9) at90 = i / 60;
    }
    expect(s.pitch).toBeCloseTo(target, 3);
    expect(peak).toBeLessThanOrEqual(target + 1e-6);
    // A critically damped 2 Hz spring is 90% there in about 0.3 s: quick, not instant.
    expect(at90).toBeGreaterThan(0.15);
    expect(at90).toBeLessThan(0.5);
  });

  it("dips on landing from a fall, then comes back to the ground", () => {
    const s = new CartSuspension();
    let y = 5;
    for (let i = 0; i < 30; i++) {
      y -= 0.12;
      s.update(1 / 60, 0, y, 0, 0, flat);
    }
    let lowest = 0;
    for (let i = 0; i < 120; i++) {
      s.update(1 / 60, 0, y, 0, 0, flat);
      lowest = Math.min(lowest, s.heave);
    }
    expect(lowest).toBeLessThan(-0.05);
    expect(Math.abs(s.heave)).toBeLessThan(0.01);
  });

  it("stays still over a long frame rather than blowing up", () => {
    const s = new CartSuspension();
    s.update(0.5, 0, 0, 0, 0, rise);
    expect(Number.isFinite(s.pitch)).toBe(true);
    expect(s.pitch).toBeLessThanOrEqual(Math.atan(0.25) + 1e-6);
  });
});
