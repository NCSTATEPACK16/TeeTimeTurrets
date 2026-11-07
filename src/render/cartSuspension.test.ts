import { describe, expect, it } from "vitest";
import { CartSuspension } from "./cartSuspension";

/** The render-only suspension (#51): it fits the ground's tilt, settles, and dips on a landing. */

const DT = 1 / 60;

/** `frames` of a cart standing at the origin facing +x on ground `heightAt`, at ground height `y`. */
function settle(s: CartSuspension, heightAt: (x: number, z: number) => number, frames: number, y = 0): void {
  for (let i = 0; i < frames; i++) s.update(0, y, 0, 0, heightAt, DT);
}

describe("cart suspension", () => {
  it("noses up a rise and leans to the high side, from the four wheel contacts", () => {
    // Facing +x: ground rising ahead at 10%, and toward -z, which is the body's local +x (its left).
    const s = new CartSuspension();
    settle(s, (x, z) => 0.1 * x - 0.05 * z, 120);
    expect(s.pitch).toBeCloseTo(-Math.atan(0.1), 3);
    expect(s.roll).toBeCloseTo(Math.atan(0.05), 3);
  });

  it("springs toward a new slope without overshooting it", () => {
    const s = new CartSuspension();
    settle(s, () => 0, 1);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      s.update(0, 0, 0, 0, (x) => 0.2 * x, DT);
      peak = Math.min(peak, s.pitch);
    }
    const target = -Math.atan(0.2);
    // Critically damped: it reaches the slope and never passes it.
    expect(s.pitch).toBeCloseTo(target, 3);
    expect(peak).toBeGreaterThanOrEqual(target - 1e-6);
    // And it is a spring, not a snap: a quarter second in it was still on its way.
    const t = new CartSuspension();
    settle(t, () => 0, 1);
    for (let i = 0; i < 15; i++) t.update(0, 0, 0, 0, (x) => 0.2 * x, DT);
    expect(t.pitch).toBeGreaterThan(target * 0.95);
  });

  it("dips on landing from a jump and recovers", () => {
    const s = new CartSuspension();
    const flat = (): number => 0;
    settle(s, flat, 30);
    // A drop from 2 m at 6 m/s onto flat ground, then standing still. The body dips under it.
    let lowest = 0;
    for (let i = 0; i <= 20; i++) {
      s.update(0, 2 - i * 0.1, 0, 0, flat, DT);
      lowest = Math.min(lowest, s.heave);
    }
    for (let i = 0; i < 20; i++) {
      settle(s, flat, 1);
      lowest = Math.min(lowest, s.heave);
    }
    expect(lowest).toBeLessThan(-0.05);
    settle(s, flat, 120);
    expect(Math.abs(s.heave)).toBeLessThan(1e-3);
  });
});
