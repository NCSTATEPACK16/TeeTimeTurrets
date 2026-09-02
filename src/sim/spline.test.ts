import { describe, expect, it } from "vitest";
import { createNearestPoint, createSpline } from "./spline";
import type { Vec2 } from "./course";

/**
 * Unevenly spaced on purpose: a tight cluster followed by a long run is exactly the
 * configuration where uniform Catmull-Rom overshoots into a cusp, and it is also what a
 * dog-legged hole looks like when the apex sits close to the tee.
 */
const ADVERSARIAL: readonly Vec2[] = [
  { x: 0, z: 0 },
  { x: 2, z: 1 },
  { x: 3, z: 1.2 },
  { x: 60, z: 20 },
];

/** Largest turn between consecutive polyline segments, radians. A cusp is a near-pi turn. */
function maxTurnAngle(points: readonly Vec2[]): number {
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const az = points[i].z - points[i - 1].z;
    const bx = points[i + 1].x - points[i].x;
    const bz = points[i + 1].z - points[i].z;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = Math.min(1, Math.max(-1, (ax * bx + az * bz) / (la * lb)));
    worst = Math.max(worst, Math.acos(cos));
  }
  return worst;
}

function sample(spline: ReturnType<typeof createSpline>, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(spline.pointAt(i / n));
  return out;
}

describe("createSpline", () => {
  it("passes through the first and last control points", () => {
    const s = createSpline(ADVERSARIAL);
    expect(s.pointAt(0).x).toBeCloseTo(0, 6);
    expect(s.pointAt(0).z).toBeCloseTo(0, 6);
    expect(s.pointAt(1).x).toBeCloseTo(60, 6);
    expect(s.pointAt(1).z).toBeCloseTo(20, 6);
  });

  it("clamps t outside [0, 1] rather than extrapolating", () => {
    const s = createSpline(ADVERSARIAL);
    expect(s.pointAt(-5)).toEqual(s.pointAt(0));
    expect(s.pointAt(5)).toEqual(s.pointAt(1));
  });

  it("alpha = 0.5 produces no cusp where uniform parameterisation does", () => {
    const centripetal = maxTurnAngle(sample(createSpline(ADVERSARIAL, 0.5), 400));
    const uniform = maxTurnAngle(sample(createSpline(ADVERSARIAL, 0), 400));
    // A cusp is a reversal: the curve turns through most of a half-circle in one step.
    expect(uniform).toBeGreaterThan(1.2);
    expect(centripetal).toBeLessThan(0.5);
  });

  it("is monotone in arc length: t maps to distance travelled", () => {
    const s = createSpline(ADVERSARIAL);
    let travelled = 0;
    let previous = s.pointAt(0);
    for (let i = 1; i <= 200; i++) {
      const p = s.pointAt(i / 200);
      travelled += Math.hypot(p.x - previous.x, p.z - previous.z);
      previous = p;
      // Arc length reached by parameter t is t * length, to within one sample's chord.
      expect(Math.abs(travelled - (i / 200) * s.length)).toBeLessThan(s.length / 100);
    }
  });

  it("length grows when the control points spread out", () => {
    const tight = createSpline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ]);
    const bent = createSpline([
      { x: 0, z: 0 },
      { x: 10, z: 15 },
      { x: 20, z: 0 },
    ]);
    expect(tight.length).toBeCloseTo(20, 1);
    expect(bent.length).toBeGreaterThan(tight.length);
  });

  it("nearest agrees with brute-force sampling to within a centimetre", () => {
    const s = createSpline(ADVERSARIAL);
    const dense: Vec2[] = sample(s, 20000);
    const probes = [
      { x: 5, z: 10 },
      { x: 30, z: -8 },
      { x: 61, z: 21 },
      { x: -4, z: -3 },
      { x: 1.5, z: 1.5 },
    ];
    for (const probe of probes) {
      let brute = Infinity;
      for (const p of dense) brute = Math.min(brute, Math.hypot(p.x - probe.x, p.z - probe.z));
      expect(Math.abs(s.nearest(probe.x, probe.z).distance - brute)).toBeLessThan(0.01);
    }
  });

  it("nearest returns a t that pointAt maps back to the measured point", () => {
    const s = createSpline(ADVERSARIAL);
    const probe = { x: 30, z: -8 };
    const hit = s.nearest(probe.x, probe.z);
    const p = s.pointAt(hit.t);
    expect(Math.hypot(p.x - probe.x, p.z - probe.z)).toBeCloseTo(hit.distance, 9);
  });

  it("nearest is zero on the curve itself", () => {
    const s = createSpline(ADVERSARIAL);
    for (let i = 0; i <= 20; i++) {
      const p = s.pointAt(i / 20);
      expect(s.nearest(p.x, p.z).distance).toBeLessThan(1e-6);
    }
  });

  it("nearestInto and pointInto write into the caller's object and match the allocating variants' results", () => {
    const s = createSpline(ADVERSARIAL);
    const hit = createNearestPoint();
    const point = { x: 0, z: 0 };
    s.nearestInto(30, -8, hit);
    s.pointInto(hit.t, point);
    expect(hit).toEqual(s.nearest(30, -8));
    expect(point).toEqual({ x: s.pointAt(hit.t).x, z: s.pointAt(hit.t).z });
  });

  it("tangentInto returns a unit vector pointing tee-to-cup", () => {
    const s = createSpline([
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ]);
    const tangent = { x: 0, z: 0 };
    s.tangentInto(0.5, tangent);
    expect(Math.hypot(tangent.x, tangent.z)).toBeCloseTo(1, 6);
    expect(tangent.x).toBeCloseTo(1, 6);
    expect(tangent.z).toBeCloseTo(0, 6);
  });

  it("rejects fewer than two control points", () => {
    expect(() => createSpline([{ x: 0, z: 0 }])).toThrow(/at least two/i);
  });

  it("survives duplicated control points without producing NaN", () => {
    const s = createSpline([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
    for (let i = 0; i <= 20; i++) {
      const p = s.pointAt(i / 20);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});
