import { describe, expect, it } from "vitest";
import { contours, corridorPolylines, niceInterval, surfaceRuns } from "./mapGeometry";
import type { CorridorSource, HeightSampler, SurfaceSampler } from "./mapGeometry";
import { SurfaceId } from "./surfaces";

/**
 * These guard a shared implementation: `tools/holePlan.ts` renders the committed plan SVGs from
 * the same functions the in-game map draws. The 18 files in `docs/course/plans/` are the byte-exact
 * regression check on the numbers; what is asserted here is the structure those numbers have to
 * hold, which a diff of 3 MB of path data would not show.
 */

const FIELD = { fieldSize: 200 };

/** Ground that rises one metre per metre of +X, so contour levels are evenly spaced planes. */
const ramp: HeightSampler = { heightAt: (x) => x };
const flat: HeightSampler = { heightAt: () => 4 };

/** Fairway down the middle third of X, rough either side. */
const striped: SurfaceSampler = {
  surfaceAt: (x) => (x > -33 && x < 33 ? SurfaceId.Fairway : SurfaceId.Rough),
};

/** A straight centreline down +Z through the origin, with a constant 10 m half-width. */
function straightCorridor(halfWidth: number): CorridorSource {
  return {
    spline: {
      pointAt: (t) => ({ x: 0, z: -100 + t * 200 }),
      tangentInto: (_t, out) => {
        out.x = 0;
        out.z = 1;
      },
    },
    spec: { corridor: [halfWidth] },
  };
}

describe("surfaceRuns", () => {
  it("tiles every row completely, with no gap and no overlap", () => {
    const samples = 40;
    const runs = surfaceRuns(FIELD, striped, samples);
    for (let row = 0; row < samples; row++) {
      const inRow = runs.filter((r) => r.row === row);
      expect(inRow.length).toBeGreaterThan(0);
      expect(inRow[0]!.colStart).toBe(0);
      expect(inRow[inRow.length - 1]!.colEnd).toBe(samples);
      for (let i = 1; i < inRow.length; i++) {
        expect(inRow[i]!.colStart).toBe(inRow[i - 1]!.colEnd);
      }
    }
  });

  it("merges adjacent samples of one surface rather than emitting a run per cell", () => {
    const samples = 40;
    const striped3 = surfaceRuns(FIELD, striped, samples).filter((r) => r.row === 0);
    // Rough | fairway | rough is three runs, not forty cells.
    expect(striped3).toHaveLength(3);
    expect(striped3.map((r) => r.surface)).toEqual([
      SurfaceId.Rough,
      SurfaceId.Fairway,
      SurfaceId.Rough,
    ]);
    // A single-surface field collapses to one run, proving the merge is driven by the samples
    // and not by a hardcoded split.
    const uniform = surfaceRuns(FIELD, { surfaceAt: () => SurfaceId.Green }, samples);
    expect(uniform.filter((r) => r.row === 0)).toHaveLength(1);
  });

  it("never emits two adjacent runs of the same surface", () => {
    for (const run of groupRows(surfaceRuns(FIELD, striped, 40))) {
      for (let i = 1; i < run.length; i++) {
        expect(run[i]!.surface).not.toBe(run[i - 1]!.surface);
      }
    }
  });
});

function groupRows<T extends { row: number }>(items: T[]): T[][] {
  const rows = new Map<number, T[]>();
  for (const item of items) {
    const bucket = rows.get(item.row);
    if (bucket) bucket.push(item);
    else rows.set(item.row, [item]);
  }
  return [...rows.values()];
}

describe("contours", () => {
  it("finds no contour on flat ground and does find one on a slope", () => {
    expect(contours(FIELD, flat, 16, 9).segments).toHaveLength(0);
    expect(contours(FIELD, ramp, 16, 9).segments.length).toBeGreaterThan(0);
  });

  it("keeps every segment inside the field", () => {
    const half = FIELD.fieldSize / 2;
    for (const s of contours(FIELD, ramp, 16, 9).segments) {
      for (const v of [s.ax, s.az, s.bx, s.bz]) {
        expect(v).toBeGreaterThanOrEqual(-half - 1e-9);
        expect(v).toBeLessThanOrEqual(half + 1e-9);
      }
    }
  });

  it("runs contours across the slope: a ramp in X gives segments of constant X", () => {
    // On heightAt = x, a level set is the plane x = level, so both ends of every segment share
    // an X. This is what proves the crossing interpolation is on the right axis.
    for (const s of contours(FIELD, ramp, 16, 9).segments) {
      expect(s.ax).toBeCloseTo(s.bx, 6);
    }
  });

  it("asks for roughly the requested number of levels", () => {
    // The ramp spans 200 m across the field, so ~9 levels wants an interval near 22 -> 20.
    expect(contours(FIELD, ramp, 16, 9).interval).toBe(20);
    // Twice as many levels halves the interval to the next nice number down.
    expect(contours(FIELD, ramp, 16, 18).interval).toBe(10);
  });
});

describe("niceInterval", () => {
  it("snaps down to 1, 2 or 5 times a power of ten", () => {
    expect(niceInterval(1)).toBe(1);
    expect(niceInterval(1.9)).toBe(1);
    expect(niceInterval(2.4)).toBe(2);
    expect(niceInterval(4.9)).toBe(2);
    expect(niceInterval(7)).toBe(5);
    expect(niceInterval(22)).toBe(20);
    expect(niceInterval(0.37)).toBeCloseTo(0.2, 10);
  });
});

describe("corridorPolylines", () => {
  it("returns one point per step, plus the closing one", () => {
    const line = corridorPolylines(straightCorridor(10), 8);
    expect(line.centre).toHaveLength(9);
    expect(line.left).toHaveLength(9);
    expect(line.right).toHaveLength(9);
  });

  it("offsets the edges perpendicular to the centreline by the half-width", () => {
    const line = corridorPolylines(straightCorridor(10), 4);
    for (let i = 0; i < line.centre.length; i++) {
      // Tangent is +Z, so the normal is X: edges sit at x = -10 and x = +10, z unchanged.
      expect(line.left[i]!.x).toBeCloseTo(-10, 9);
      expect(line.right[i]!.x).toBeCloseTo(10, 9);
      expect(line.left[i]!.z).toBeCloseTo(line.centre[i]!.z, 9);
    }
  });

  it("widens the corridor when the hole's half-width does", () => {
    // Paired against the 10 m case so this cannot pass on a hardcoded offset.
    const wide = corridorPolylines(straightCorridor(25), 4);
    expect(wide.left[0]!.x).toBeCloseTo(-25, 9);
    expect(wide.right[0]!.x).toBeCloseTo(25, 9);
  });

  it("copies each point rather than aliasing the spline's scratch object", () => {
    // `Spline.pointAt` is free to return a reused vector; a polyline that stored the reference
    // would come back as N copies of the last point.
    const line = corridorPolylines(straightCorridor(10), 4);
    expect(line.centre[0]!.z).not.toBeCloseTo(line.centre[4]!.z, 6);
  });
});
