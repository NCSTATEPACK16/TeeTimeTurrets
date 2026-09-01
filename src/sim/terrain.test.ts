import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import {
  BLEND_WIDTH,
  GRAD_FAIRWAY,
  GRAD_GREEN,
  GREEN_RADIUS,
  HALF_WIDTH,
  createTerrain,
} from "./terrain";
import type { Terrain } from "./terrain";

const SPEC = fixedHoleSpec();
const terrain = createTerrain(SPEC);

/** Central-difference gradient magnitude, in the same rise-over-run units as the budgets. */
function gradientAt(t: Terrain, x: number, z: number, h = 0.5): number {
  const dx = (t.heightAt(x + h, z) - t.heightAt(x - h, z)) / (2 * h);
  const dz = (t.heightAt(x, z + h) - t.heightAt(x, z - h)) / (2 * h);
  return Math.hypot(dx, dz);
}

describe("budget-driven masking", () => {
  it("holds the green inside the green's own rest threshold", () => {
    // The pad flattens the middle, so sample the annulus where the budget is doing the work.
    let worst = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
      for (let r = 1; r <= GREEN_RADIUS; r += 1) {
        worst = Math.max(
          worst,
          gradientAt(terrain, SPEC.cup.x + Math.cos(a) * r, SPEC.cup.z + Math.sin(a) * r),
        );
      }
    }
    expect(worst).toBeLessThanOrEqual(GRAD_GREEN);
  });

  it("holds the corridor inside the fairway's rest threshold", () => {
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      for (let offset = -HALF_WIDTH; offset <= HALF_WIDTH; offset += 5) {
        worst = Math.max(worst, gradientAt(terrain, centre.x + offset, centre.z));
      }
    }
    expect(worst).toBeLessThanOrEqual(GRAD_FAIRWAY);
  });

  it("lets the rough run unbudgeted, so a ball on a hillside keeps rolling out of it", () => {
    // GRAD_ROUGH is deliberately 0.28, above the rough's own 0.22 rest threshold: the rough is
    // the unmasked octave sum. Assert it is actually steeper somewhere than the fairway allows.
    let worst = 0;
    for (let x = -78; x <= 78; x += 3) {
      for (let z = -78; z <= 78; z += 3) {
        if (terrain.spline.nearest(x, z).distance < HALF_WIDTH + BLEND_WIDTH) continue;
        worst = Math.max(worst, gradientAt(terrain, x, z));
      }
    }
    expect(worst).toBeGreaterThan(GRAD_FAIRWAY);
  });

  it("exposes the corridor spline built from the spec's control points", () => {
    expect(terrain.spline.pointAt(0).x).toBeCloseTo(SPEC.tee.x, 6);
    expect(terrain.spline.pointAt(1).x).toBeCloseTo(SPEC.cup.x, 6);
    expect(terrain.spline.length).toBeGreaterThan(90);
  });

  it("is a pure function of (x, z): repeated and out-of-order calls agree", () => {
    const a = terrain.heightAt(12, -7);
    terrain.heightAt(-60, 40);
    terrain.heightAt(0, 0);
    expect(terrain.heightAt(12, -7)).toBe(a);
  });
});
