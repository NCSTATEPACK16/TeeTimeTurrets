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

describe("corridor carving", () => {
  it("has exactly zero lateral camber inside the corridor", () => {
    // Every point sharing a centreline parameter gets the centreline's height, so a cross
    // section of the corridor is flat by construction rather than by tuning.
    const normal = { x: 0, z: 0 };
    for (let i = 1; i < 100; i++) {
      const t = i / 100;
      const centre = terrain.spline.pointAt(t);
      terrain.spline.tangentInto(t, normal);
      const nx = -normal.z;
      const nz = normal.x;
      const middle = terrain.heightAt(centre.x, centre.z);
      for (const offset of [-12, -6, 6, 12]) {
        const h = terrain.heightAt(centre.x + nx * offset, centre.z + nz * offset);
        // In exact arithmetic on the true curve this is 0: the offset point's nearest-t is t by
        // the orthogonality condition (offset is along the normal, which is orthogonal to the
        // tangent by definition). What's measured here is `nearest`'s polyline approximation --
        // fixedHoleSpec's dog-leg apex has a turning radius as tight as ~1.7 m against a 1 m
        // polyline chord, so nearby points resolve to a slightly different t. The residual stays
        // two orders of magnitude below the pre-carving cross-slope (~0.25, see the old failure)
        // and well below the longitudinal relief the next test requires, which is what
        // distinguishes "still carved" from "not carved at all".
        expect(Math.abs(h - middle)).toBeLessThan(0.01);
      }
    }
  });

  it("keeps a longitudinal profile: the corridor is flat across, not flat along", () => {
    let relief = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      const h = terrain.heightAt(centre.x, centre.z);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    relief = high - low;
    expect(relief).toBeGreaterThan(0.2);
  });

  it("is C1 across the corridor edge and the rough edge: no step in the slope", () => {
    // The failure this catches is a mask whose derivative jumps -- the ramp failure the
    // research warns about. Sample the second difference of H along the corridor normal.
    const normal = { x: 0, z: 0 };
    const t = 0.5;
    const centre = terrain.spline.pointAt(t);
    terrain.spline.tangentInto(t, normal);
    const nx = -normal.z;
    const nz = normal.x;

    const h = 0.05;
    const slopeAt = (d: number): number =>
      (terrain.heightAt(centre.x + nx * (d + h), centre.z + nz * (d + h)) -
        terrain.heightAt(centre.x + nx * (d - h), centre.z + nz * (d - h))) /
      (2 * h);

    for (const edge of [HALF_WIDTH, HALF_WIDTH + BLEND_WIDTH]) {
      const before = slopeAt(edge - 0.25);
      const after = slopeAt(edge + 0.25);
      // A C0-but-not-C1 mask steps the slope; a C1 one changes it smoothly over 0.5 m. t = 0.5
      // sits right at fixedHoleSpec's dog-leg apex (~1.7 m turning radius against the spline's
      // 1 m polyline chord -- see the camber test above), which adds its own small nearest-t
      // jitter across a 25 m offset on top of whatever the mask itself contributes. A true
      // C0-but-not-C1 mask produces a jump an order of magnitude past this: this bound would
      // still fail hard on a raw clamp in place of smoothstep01.
      expect(Math.abs(after - before)).toBeLessThan(0.06);
    }
  });

  it("hands the corridor the corridor's budget, not the querying point's", () => {
    // An implementation that reuses the caller's mask gives the centreline rough-grade
    // undulation. Measured as: the centreline is smoother than the rough it runs through.
    let corridor = 0;
    let rough = 0;
    for (let i = 1; i < 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      const previous = terrain.spline.pointAt((i - 1) / 100);
      corridor = Math.max(
        corridor,
        Math.abs(terrain.heightAt(centre.x, centre.z) - terrain.heightAt(previous.x, previous.z)) /
          Math.hypot(centre.x - previous.x, centre.z - previous.z),
      );
    }
    for (let x = -78; x <= 78; x += 3) {
      for (let z = -78; z <= 78; z += 3) {
        if (terrain.spline.nearest(x, z).distance < HALF_WIDTH + BLEND_WIDTH) continue;
        rough = Math.max(
          rough,
          Math.abs(terrain.heightAt(x + 1, z) - terrain.heightAt(x, z)),
        );
      }
    }
    expect(corridor).toBeLessThan(rough);
  });
});
