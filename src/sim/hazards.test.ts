import { describe, expect, it } from "vitest";
import {
  ellipseEdgeDistance,
  ellipseFalloff,
  pointInEllipse,
  pointInPolygon,
  polygonDistance,
  polygonSignedDistance,
} from "./hazards";
import type { Ellipse, Polygon } from "./hazards";

/** 20 m x 6 m, long axis on X, unrotated. A greenside bunker's rough shape. */
const wide: Ellipse = { x: 0, z: 0, radiusX: 10, radiusZ: 3, rotation: 0 };

/** The same ellipse turned a quarter turn: long axis now on Z. */
const turned: Ellipse = { ...wide, rotation: Math.PI / 2 };

/** A 20 m square centred on the origin. */
const square: Polygon = {
  points: [
    { x: -10, z: -10 },
    { x: 10, z: -10 },
    { x: 10, z: 10 },
    { x: -10, z: 10 },
  ],
};

/**
 * An L. The notch at (7, 7) is outside the shape but inside its bounding box and inside its
 * convex hull -- which is the case a convex-only or bounding-box test gets wrong, and the case
 * that matters, because a lateral water hazard wrapping a dog-leg elbow is concave.
 */
const ell: Polygon = {
  points: [
    { x: -10, z: -10 },
    { x: 10, z: -10 },
    { x: 10, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 10 },
    { x: -10, z: 10 },
  ],
};

describe("pointInEllipse", () => {
  it("contains its own centre", () => {
    expect(pointInEllipse(0, 0, wide)).toBe(true);
  });

  it("excludes a point past the rim on each axis", () => {
    expect(pointInEllipse(10.5, 0, wide)).toBe(false);
    expect(pointInEllipse(0, 3.5, wide)).toBe(false);
  });

  it("includes a point inside the rim on each axis", () => {
    expect(pointInEllipse(9.5, 0, wide)).toBe(true);
    expect(pointInEllipse(0, 2.5, wide)).toBe(true);
  });

  it("respects rotation rather than treating the ellipse as axis-aligned", () => {
    // (0, 8) is well outside the wide ellipse and well inside the turned one. An implementation
    // that ignores `rotation` gets both of these backwards.
    expect(pointInEllipse(0, 8, wide)).toBe(false);
    expect(pointInEllipse(0, 8, turned)).toBe(true);
    expect(pointInEllipse(8, 0, wide)).toBe(true);
    expect(pointInEllipse(8, 0, turned)).toBe(false);
  });

  it("is translation-independent", () => {
    const moved: Ellipse = { ...wide, x: 100, z: -40 };
    expect(pointInEllipse(100, -40, moved)).toBe(true);
    expect(pointInEllipse(0, 0, moved)).toBe(false);
  });
});

describe("ellipseFalloff", () => {
  it("is 1 at the centre and 0 at the rim", () => {
    expect(ellipseFalloff(0, 0, wide)).toBeCloseTo(1, 6);
    expect(ellipseFalloff(10, 0, wide)).toBeCloseTo(0, 6);
    expect(ellipseFalloff(0, 3, wide)).toBeCloseTo(0, 6);
  });

  it("is 0 outside, never negative", () => {
    expect(ellipseFalloff(50, 0, wide)).toBe(0);
    expect(ellipseFalloff(0, -20, wide)).toBe(0);
  });

  it("falls monotonically from centre to rim", () => {
    const samples = [0, 2, 4, 6, 8, 10].map((x) => ellipseFalloff(x, 0, wide));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
  });
});

describe("pointInPolygon", () => {
  it("contains an interior point and excludes an exterior one", () => {
    expect(pointInPolygon(0, 0, square)).toBe(true);
    expect(pointInPolygon(20, 0, square)).toBe(false);
    expect(pointInPolygon(0, -30, square)).toBe(false);
  });

  it("excludes the notch of a concave polygon", () => {
    // Inside the bounding box, inside the convex hull, outside the shape.
    expect(pointInPolygon(7, 7, ell)).toBe(false);
    // ...while the two arms of the L are inside.
    expect(pointInPolygon(-5, 5, ell)).toBe(true);
    expect(pointInPolygon(5, -5, ell)).toBe(true);
  });

  it("does not let a vertex-aligned ray double-count a crossing", () => {
    // A horizontal ray from (0, -10) runs exactly through two vertices of `square`. A naive
    // crossing test counts each twice and reports the interior point as outside.
    expect(pointInPolygon(0, -10 + 1e-9, square)).toBe(true);
    expect(pointInPolygon(0, 10 - 1e-9, square)).toBe(true);
  });
});

describe("polygonDistance", () => {
  it("is zero on an edge and on a vertex", () => {
    expect(polygonDistance(0, -10, square)).toBeCloseTo(0, 6);
    expect(polygonDistance(10, 10, square)).toBeCloseTo(0, 6);
  });

  it("measures to the nearest edge from inside", () => {
    expect(polygonDistance(0, 0, square)).toBeCloseTo(10, 6);
    expect(polygonDistance(6, 0, square)).toBeCloseTo(4, 6);
  });

  it("measures to the nearest edge from outside", () => {
    expect(polygonDistance(15, 0, square)).toBeCloseTo(5, 6);
    // Nearest feature is the corner, not an edge line: hypot(5, 5).
    expect(polygonDistance(15, 15, square)).toBeCloseTo(Math.hypot(5, 5), 6);
  });
});

describe("polygonSignedDistance", () => {
  it("is negative inside and positive outside", () => {
    expect(polygonSignedDistance(0, 0, square)).toBeCloseTo(-10, 6);
    expect(polygonSignedDistance(15, 0, square)).toBeCloseTo(5, 6);
  });

  it("agrees with pointInPolygon on the concave case", () => {
    expect(polygonSignedDistance(7, 7, ell)).toBeGreaterThan(0);
    expect(polygonSignedDistance(-5, 5, ell)).toBeLessThan(0);
  });
});

describe("ellipseEdgeDistance", () => {
  it("is negative inside, zero on the rim and positive outside", () => {
    expect(ellipseEdgeDistance(0, 0, wide)).toBeLessThan(0);
    expect(ellipseEdgeDistance(10, 0, wide)).toBeCloseTo(0, 6);
    expect(ellipseEdgeDistance(0, 3, wide)).toBeCloseTo(0, 6);
    expect(ellipseEdgeDistance(0, 6, wide)).toBeGreaterThan(0);
  });

  it("grows with distance outside the rim", () => {
    const near = ellipseEdgeDistance(12, 0, wide);
    const far = ellipseEdgeDistance(20, 0, wide);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
  });

  it("reduces to the radial distance for a circle", () => {
    const circle: Ellipse = { x: 0, z: 0, radiusX: 11, radiusZ: 11, rotation: 0 };
    expect(ellipseEdgeDistance(15, 0, circle)).toBeCloseTo(4, 6);
    expect(ellipseEdgeDistance(0, 5, circle)).toBeCloseTo(-6, 6);
  });
});
