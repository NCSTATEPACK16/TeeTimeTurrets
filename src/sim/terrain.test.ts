import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import {
  BLEND_WIDTH,
  GRAD_FAIRWAY,
  GRAD_GREEN,
  GREEN_RADIUS,
  HALF_WIDTH,
  createTerrain,
  halfWidthAt,
} from "./terrain";
import type { Terrain } from "./terrain";
import type { Ellipse, Polygon } from "./hazards";

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
    // t = 0.5 sits right at fixedHoleSpec's dog-leg apex (~1.7-3 m turning radius against the
    // spline's 1 m polyline chord -- see the camber test above), where curvature-driven
    // nearest-t jitter across a 25 m offset is the same order of magnitude as the signal this
    // test is trying to isolate, so it can't discriminate a genuine C0-but-not-C1 mask there
    // (measured: a raw clamp in place of smoothstep01 gives ~4.67e-2, indistinguishable from the
    // correct ~4.84e-2). t = 0.7 sits on a gentler stretch of the corridor -- measured turning
    // radius well past the apex's -- where the same swap gives ~1.94e-2 against a correct ~2.9e-3,
    // a clean 6-7x separation.
    const t = 0.7;
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
      // A C0-but-not-C1 mask steps the slope; a C1 one changes it smoothly over 0.5 m.
      expect(Math.abs(after - before)).toBeLessThan(0.008);
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

/**
 * Tier 2, docs/COURSE_PIPELINE.md §5. A placed hazard has to be shaped as well as classified --
 * otherwise water is a blue rectangle painted on a hillside and a bunker is flat ground coloured
 * tan, and a ball rolls across both without noticing.
 */
describe("hazard shaping", () => {
  const pond: Polygon = {
    points: [
      { x: -20, z: 25 },
      { x: 20, z: 25 },
      { x: 20, z: 60 },
      { x: -20, z: 60 },
    ],
  };
  const bunker: Ellipse = { x: -30, z: 40, radiusX: 9, radiusZ: 6, rotation: 0 };

  it("carves the ground under a water polygon below the water line", () => {
    const spec = { ...SPEC, water: [pond] };
    const wet = createTerrain(spec);
    const dry = createTerrain({ ...SPEC, water: [] });

    // Three claims, and the third is what stops the first two passing on a hole where the ground
    // was already low. Some of this fixture's ground under the pond genuinely is below the floor
    // already, so "strictly lower everywhere" would be false for the right reason -- a basin
    // excavates and never fills, so it leaves a natural hollow alone.
    let cut = 0;
    for (let x = -16; x <= 16; x += 4) {
      for (let z = 32; z <= 54; z += 4) {
        const w = wet.heightAt(x, z);
        const d = dry.heightAt(x, z);
        // 1. Well inside the bank, the ground is always under the rendered water plane.
        expect(w).toBeLessThan(spec.waterLevel);
        // 2. The basin never raises ground.
        expect(w).toBeLessThanOrEqual(d + 1e-9);
        if (w < d - 1e-6) cut += 1;
      }
    }
    // 3. ...and it did in fact dig, rather than agreeing with the terrain by luck.
    expect(cut).toBeGreaterThan(0);
  });

  it("leaves ground outside the polygon exactly as it was", () => {
    const dry = createTerrain({ ...SPEC, water: [] });
    const wet = createTerrain({ ...SPEC, water: [pond] });
    // Far from the pond: byte-identical, so a hazard cannot silently reshape a whole hole.
    for (const [x, z] of [
      [-60, -40],
      [40, -10],
      [0, -60],
    ] as const) {
      expect(wet.heightAt(x, z)).toBe(dry.heightAt(x, z));
    }
  });

  it("ramps into the basin rather than dropping a cliff at the bank", () => {
    const wet = createTerrain({ ...SPEC, water: [pond] });
    // Walk across the northern bank. No single 0.5 m step may fall more than a modest amount,
    // or the ball tunnels through a wall instead of rolling down a shore.
    let worst = 0;
    for (let z = 20; z < 35; z += 0.5) {
      const drop = wet.heightAt(0, z) - wet.heightAt(0, z + 0.5);
      worst = Math.max(worst, drop);
    }
    expect(worst).toBeLessThan(0.5);
  });

  it("dishes a bunker below the ground it sits in", () => {
    const flat = createTerrain({ ...SPEC, bunkers: [] });
    const dished = createTerrain({ ...SPEC, bunkers: [bunker] });
    expect(dished.heightAt(bunker.x, bunker.z)).toBeLessThan(flat.heightAt(bunker.x, bunker.z));
    // The rim is where the dishing stops.
    expect(dished.heightAt(bunker.x + bunker.radiusX, bunker.z)).toBeCloseTo(
      flat.heightAt(bunker.x + bunker.radiusX, bunker.z),
      6,
    );
  });

  it("dishes a bunker deepest at its centre", () => {
    const flat = createTerrain({ ...SPEC, bunkers: [] });
    const dished = createTerrain({ ...SPEC, bunkers: [bunker] });
    const dropAt = (x: number, z: number) => flat.heightAt(x, z) - dished.heightAt(x, z);
    expect(dropAt(bunker.x, bunker.z)).toBeGreaterThan(dropAt(bunker.x + 5, bunker.z));
    expect(dropAt(bunker.x + 5, bunker.z)).toBeGreaterThan(dropAt(bunker.x + 8, bunker.z));
  });

  it("leaves a hazard-free hole's terrain untouched", () => {
    // The regression guard for the eleven briefs that ask for nothing: adding hazard support
    // must not move ground on a hole that has none.
    const before = createTerrain({ ...SPEC, water: [], bunkers: [] });
    for (let x = -70; x <= 70; x += 11) {
      for (let z = -70; z <= 70; z += 11) {
        expect(before.heightAt(x, z)).toBe(terrain.heightAt(x, z));
      }
    }
  });
});

/**
 * Tier 2. `HALF_WIDTH` stops being a global and becomes `spec.corridor` -- a half-width per
 * control point, interpolated along the spline. This is the briefs' combat axis made geometric:
 * hole 5 is a knife fight at 10 m and hole 9 a shooting gallery at 19 m.
 */
describe("per-hole corridor width", () => {
  it("interpolates between the control points' half-widths", () => {
    expect(halfWidthAt([10, 20, 10], 0)).toBeCloseTo(10, 6);
    expect(halfWidthAt([10, 20, 10], 0.5)).toBeCloseTo(20, 6);
    expect(halfWidthAt([10, 20, 10], 1)).toBeCloseTo(10, 6);
    expect(halfWidthAt([10, 20, 10], 0.25)).toBeCloseTo(15, 6);
  });

  it("clamps outside [0, 1] rather than extrapolating off the ends", () => {
    expect(halfWidthAt([10, 20, 30], -0.5)).toBeCloseTo(10, 6);
    expect(halfWidthAt([10, 20, 30], 1.5)).toBeCloseTo(30, 6);
  });

  it("carves a wider corridor flat further out than a narrow one does", () => {
    // 18 m off the centreline is inside a 20 m corridor and outside a 10 m one, so the wide hole
    // has that point carved to the centreline height and the narrow hole leaves it to the noise.
    const narrow = createTerrain({ ...SPEC, corridor: [10, 10, 10] });
    const wide = createTerrain({ ...SPEC, corridor: [20, 20, 20] });

    const t = 0.8;
    const centre = narrow.spline.pointAt(t);
    const tangent = { x: 0, z: 0 };
    narrow.spline.tangentInto(t, tangent);
    const probe = { x: centre.x - tangent.z * 18, z: centre.z + tangent.x * 18 };

    const centreHeight = wide.heightAt(centre.x, centre.z);
    expect(wide.heightAt(probe.x, probe.z)).toBeCloseTo(centreHeight, 2);
    expect(Math.abs(narrow.heightAt(probe.x, probe.z) - centreHeight)).toBeGreaterThan(0.01);
  });

  it("reproduces today's terrain when every control point carries HALF_WIDTH", () => {
    // The migration guard: a hole authored at the old global width must be unchanged, so a
    // corridor-width change is visible only where somebody asked for one.
    const uniform = createTerrain({ ...SPEC, corridor: [HALF_WIDTH, HALF_WIDTH, HALF_WIDTH] });
    for (let x = -70; x <= 70; x += 9) {
      for (let z = -70; z <= 70; z += 9) {
        expect(uniform.heightAt(x, z)).toBe(terrain.heightAt(x, z));
      }
    }
  });
});
