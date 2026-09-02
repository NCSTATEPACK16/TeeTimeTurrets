import type { Vec2 } from "./course";

/**
 * The corridor centreline: a centripetal Catmull-Rom curve through the hole's control points,
 * flattened once at construction into an arc-length-parameterised polyline.
 *
 * Centripetal parameterisation (alpha = 0.5) rather than uniform: uniform Catmull-Rom produces
 * cusps and self-intersection when control points are unevenly spaced, and a cusp in the
 * corridor centreline is a fold in the terrain. A dog-leg apex sitting close to the tee is
 * exactly the uneven spacing that triggers it.
 *
 * `t` is normalised arc length rather than a knot parameter, and both `pointAt` and `nearest`
 * read the same polyline. That makes them exact inverses -- pointAt(nearest(p).t) is the very
 * point nearest measured to -- which is what terrain.ts's carving needs for lateral camber to
 * be zero by construction rather than merely small.
 */

export interface MutableVec2 {
  x: number;
  z: number;
}

export interface NearestPoint {
  distance: number;
  t: number;
}

/** Scratch factory, so callers in the hot loop have something to reuse. */
export function createNearestPoint(): NearestPoint {
  return { distance: 0, t: 0 };
}

export interface Spline {
  pointAt(t: number): Vec2;
  pointInto(t: number, out: MutableVec2): void;
  nearest(x: number, z: number): NearestPoint;
  nearestInto(x: number, z: number, out: NearestPoint): void;
  tangentInto(t: number, out: MutableVec2): void;
  readonly length: number;
}

/**
 * Target polyline spacing. The spec sizes `nearest` at a ~200-segment scan for a ~200 m hole,
 * which is this. The per-segment floor keeps short test curves resolved finely enough that a
 * cusp is visible rather than sampled over.
 */
const SAMPLE_SPACING_M = 1.0;
const MIN_SAMPLES_PER_SEGMENT = 16;

/** Guards the knot spacing so duplicated control points cannot divide by zero. */
const MIN_KNOT_DELTA = 1e-6;

export function createSpline(control: readonly Vec2[], alpha = 0.5): Spline {
  if (control.length < 2) throw new Error("createSpline needs at least two control points");

  // Duplicate the endpoints so the first and last segments have the neighbours Catmull-Rom
  // needs. Reflecting instead would let the curve overshoot past the tee and the cup.
  const p: Vec2[] = [control[0], ...control, control[control.length - 1]];

  const knots = new Float64Array(p.length);
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    knots[i] = knots[i - 1] + Math.max(MIN_KNOT_DELTA, Math.pow(d, alpha));
  }

  /**
   * Barry-Goldman pyramidal evaluation of the segment between p[i] and p[i+1], for a knot
   * value `u` in [knots[i], knots[i+1]]. Written out rather than reduced to the uniform
   * Catmull-Rom basis matrix, because the basis matrix is only valid for evenly spaced knots
   * and using it here is the standard way to accidentally ship uniform parameterisation.
   */
  function evaluate(i: number, u: number, out: MutableVec2): void {
    const t0 = knots[i - 1];
    const t1 = knots[i];
    const t2 = knots[i + 1];
    const t3 = knots[i + 2];

    const a1x = ((t1 - u) * p[i - 1].x + (u - t0) * p[i].x) / (t1 - t0);
    const a1z = ((t1 - u) * p[i - 1].z + (u - t0) * p[i].z) / (t1 - t0);
    const a2x = ((t2 - u) * p[i].x + (u - t1) * p[i + 1].x) / (t2 - t1);
    const a2z = ((t2 - u) * p[i].z + (u - t1) * p[i + 1].z) / (t2 - t1);
    const a3x = ((t3 - u) * p[i + 1].x + (u - t2) * p[i + 2].x) / (t3 - t2);
    const a3z = ((t3 - u) * p[i + 1].z + (u - t2) * p[i + 2].z) / (t3 - t2);

    const b1x = ((t2 - u) * a1x + (u - t0) * a2x) / (t2 - t0);
    const b1z = ((t2 - u) * a1z + (u - t0) * a2z) / (t2 - t0);
    const b2x = ((t3 - u) * a2x + (u - t1) * a3x) / (t3 - t1);
    const b2z = ((t3 - u) * a2z + (u - t1) * a3z) / (t3 - t1);

    out.x = ((t2 - u) * b1x + (u - t1) * b2x) / (t2 - t1);
    out.z = ((t2 - u) * b1z + (u - t1) * b2z) / (t2 - t1);
  }

  // Flatten every interior segment into one polyline.
  const xs: number[] = [];
  const zs: number[] = [];
  const scratch: MutableVec2 = { x: 0, z: 0 };
  for (let i = 1; i < p.length - 2; i++) {
    const chord = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
    const steps = Math.max(MIN_SAMPLES_PER_SEGMENT, Math.ceil(chord / SAMPLE_SPACING_M));
    for (let s = 0; s < steps; s++) {
      evaluate(i, knots[i] + ((knots[i + 1] - knots[i]) * s) / steps, scratch);
      xs.push(scratch.x);
      zs.push(scratch.z);
    }
  }
  evaluate(p.length - 3, knots[p.length - 2], scratch);
  xs.push(scratch.x);
  zs.push(scratch.z);

  // Cumulative arc length, so t is distance travelled rather than a knot value.
  const cumulative = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  const total = cumulative[cumulative.length - 1];

  function pointInto(t: number, out: MutableVec2): void {
    const target = Math.min(1, Math.max(0, t)) * total;
    // Binary search for the segment containing `target`.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    const f = span < MIN_KNOT_DELTA ? 0 : (target - cumulative[lo]) / span;
    out.x = xs[lo] + (xs[hi] - xs[lo]) * f;
    out.z = zs[lo] + (zs[hi] - zs[lo]) * f;
  }

  function pointAt(t: number): Vec2 {
    const out: MutableVec2 = { x: 0, z: 0 };
    pointInto(t, out);
    return out;
  }

  /**
   * Brute-force scan of every segment. No acceleration structure: the polyline is ~200
   * segments and buildHeightfield is the only caller that runs it in bulk, at load time. If
   * that ever becomes the bottleneck the fix is a uniform-grid cache of nearest-t, but that is
   * speculative until measured.
   */
  function nearestInto(x: number, z: number, out: NearestPoint): void {
    let bestSq = Infinity;
    let bestArc = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const ax = xs[i];
      const az = zs[i];
      const bx = xs[i + 1] - ax;
      const bz = zs[i + 1] - az;
      const lengthSq = bx * bx + bz * bz;
      const f =
        lengthSq < MIN_KNOT_DELTA
          ? 0
          : Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / lengthSq));
      const dx = x - (ax + bx * f);
      const dz = z - (az + bz * f);
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        bestArc = cumulative[i] + f * Math.sqrt(lengthSq);
      }
    }
    out.distance = Math.sqrt(bestSq);
    out.t = total < MIN_KNOT_DELTA ? 0 : bestArc / total;
  }

  function nearest(x: number, z: number): NearestPoint {
    const out = createNearestPoint();
    nearestInto(x, z, out);
    return out;
  }

  /** Forward difference on the polyline, one sample either side, normalised. */
  function tangentInto(t: number, out: MutableVec2): void {
    const step = total < MIN_KNOT_DELTA ? 0 : SAMPLE_SPACING_M / total;
    const a: MutableVec2 = { x: 0, z: 0 };
    const b: MutableVec2 = { x: 0, z: 0 };
    pointInto(Math.max(0, t - step), a);
    pointInto(Math.min(1, t + step), b);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const magnitude = Math.hypot(dx, dz);
    if (magnitude < MIN_KNOT_DELTA) {
      out.x = 1;
      out.z = 0;
      return;
    }
    out.x = dx / magnitude;
    out.z = dz / magnitude;
  }

  return { pointAt, pointInto, nearest, nearestInto, tangentInto, length: total };
}
