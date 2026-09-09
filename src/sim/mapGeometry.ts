/**
 * The shape of a hole, as data, in world metres.
 *
 * One implementation with two consumers: `tools/holePlan.ts` formats it as committed SVG, and the
 * in-game map draws it to a canvas. They were going to be two copies of marching squares and two
 * copies of the corridor offset, and the second copy is always the one that drifts -- the plan is
 * the reference drawing of the course, so a map that disagreed with it would be a map of a hole
 * nobody plays.
 *
 * Everything here returns **world coordinates**, never pixels. Projection is the caller's, because
 * the two callers project differently: the plan fits one hole to a fixed plot, and the map fits
 * either one hole or all eighteen to a viewport that changes size.
 *
 * Pure, DOM-free and Three-free, like the rest of `src/sim/**`. Nothing here is called per frame --
 * a hole's geometry does not move, so both callers compute once and keep the result.
 */

import { halfWidthAt } from "./terrain";
import type { SurfaceId } from "./surfaces";

/* The structural slices these functions need. Structural rather than the real `HoleSpec`,
 * `Terrain` and `Surfaces` so a test can exercise the geometry against a synthetic hill without
 * standing up a heightfield -- the same idiom `hudState.ts` uses to stay free of Rapier. */

/** Just the extent: every sampler below walks a square field centred on the origin. */
export interface FieldExtent {
  readonly fieldSize: number;
}

export interface HeightSampler {
  heightAt(worldX: number, worldZ: number): number;
}

export interface SurfaceSampler {
  surfaceAt(worldX: number, worldZ: number): SurfaceId;
}

/** The spline and the per-control-point half-widths that define a hole's playable corridor. */
export interface CorridorSource {
  readonly spline: {
    pointAt(t: number): { readonly x: number; readonly z: number };
    tangentInto(t: number, out: { x: number; z: number }): void;
  };
  readonly spec: { readonly corridor: readonly number[] };
}

/** A horizontal run of one surface across a sampled row, in grid indices rather than metres. */
export interface SurfaceRun {
  readonly row: number;
  /** First column of the run. */
  readonly colStart: number;
  /** One past the last column, so `colEnd - colStart` is the run's width in samples. */
  readonly colEnd: number;
  readonly surface: SurfaceId;
}

/** One straight piece of one contour line, in world metres. */
export interface ContourSegment {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

export interface Contours {
  readonly segments: readonly ContourSegment[];
  /** Metres between adjacent contour levels. A "nice" number, for the legend. */
  readonly interval: number;
}

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface CorridorPolylines {
  readonly centre: readonly Vec2[];
  readonly left: readonly Vec2[];
  readonly right: readonly Vec2[];
}

/**
 * Surface fill as run-length-encoded rows. One cell per sample would be 40,000 elements for a
 * single hole; merging horizontal runs of the same surface takes that to a few thousand, which is
 * what keeps the committed SVGs small enough to be worth diffing and the canvas fill cheap.
 *
 * Samples at cell centres (`+ 0.5`), so a run's colour is the surface in the middle of the cell
 * rather than on its boundary, where `surfaceAt` is deciding between two answers.
 */
export function surfaceRuns(spec: FieldExtent, surfaces: SurfaceSampler, samples: number): SurfaceRun[] {
  const step = spec.fieldSize / samples;
  const origin = -spec.fieldSize / 2;
  const out: SurfaceRun[] = [];

  for (let row = 0; row < samples; row++) {
    const worldZ = origin + (row + 0.5) * step;
    let runStart = 0;
    let runSurface = surfaces.surfaceAt(origin + 0.5 * step, worldZ);

    for (let col = 1; col <= samples; col++) {
      // The final column is a sentinel that closes the last run; there is no sample there.
      const surface = col === samples ? null : surfaces.surfaceAt(origin + (col + 0.5) * step, worldZ);
      if (surface === runSurface) continue;
      out.push({ row, colStart: runStart, colEnd: col, surface: runSurface });
      if (surface === null) break;
      runStart = col;
      runSurface = surface;
    }
  }
  return out;
}

/**
 * Marching squares over `heightAt`. Saddle cells (four crossings) are paired in a fixed order
 * rather than disambiguated by the centre value -- a contour plot for reading terrain shape does
 * not need the topologically correct branch, and picking one keeps this readable.
 */
export function contours(
  spec: FieldExtent,
  terrain: HeightSampler,
  samples: number,
  targetContours: number,
): Contours {
  const n = samples;
  const step = spec.fieldSize / n;
  const origin = -spec.fieldSize / 2;
  const grid = new Float64Array((n + 1) * (n + 1));
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row <= n; row++) {
    const worldZ = origin + row * step;
    for (let col = 0; col <= n; col++) {
      const h = terrain.heightAt(origin + col * step, worldZ);
      grid[row * (n + 1) + col] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  const interval = niceInterval((max - min) / targetContours);
  const segments: ContourSegment[] = [];

  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const h00 = grid[row * (n + 1) + col]!;
        const h10 = grid[row * (n + 1) + col + 1]!;
        const h11 = grid[(row + 1) * (n + 1) + col + 1]!;
        const h01 = grid[(row + 1) * (n + 1) + col]!;

        const ax = origin + col * step;
        const bx = origin + (col + 1) * step;
        const az = origin + row * step;
        const bz = origin + (row + 1) * step;

        // Corner order runs around the cell: (col,row) -> (col+1,row) -> (col+1,row+1) -> (col,row+1).
        const crossings: { x: number; z: number }[] = [];
        pushCrossing(crossings, h00, h10, ax, az, bx, az, level);
        pushCrossing(crossings, h10, h11, bx, az, bx, bz, level);
        pushCrossing(crossings, h11, h01, bx, bz, ax, bz, level);
        pushCrossing(crossings, h01, h00, ax, bz, ax, az, level);

        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const from = crossings[i]!;
          const to = crossings[i + 1]!;
          segments.push({ ax: from.x, az: from.z, bx: to.x, bz: to.z });
        }
      }
    }
  }

  return { segments, interval };
}

/** Where `level` crosses the edge from (ax, az) to (bx, bz), if it crosses it at all. */
function pushCrossing(
  out: { x: number; z: number }[],
  ha: number,
  hb: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  level: number,
): void {
  if (ha < level === hb < level) return;
  const t = (level - ha) / (hb - ha);
  out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
}

/**
 * A "nice" interval (1, 2 or 5 x 10^k) at or below `raw`, so a legend reads in round numbers
 * instead of 0.3714 m.
 */
export function niceInterval(raw: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const normalised = raw / magnitude;
  return (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
}

/**
 * The centreline, plus the corridor edges offset along the spline normal.
 *
 * The half-width is the hole's own at each t, not a global constant: since Tier 2 a corridor
 * pinches and reopens, and an edge drawn at a fixed width would be a picture of a different hole
 * from the one the physics runs.
 */
export function corridorPolylines(terrain: CorridorSource, steps: number): CorridorPolylines {
  const spline = terrain.spline;
  const corridor = terrain.spec.corridor;
  const centre: Vec2[] = [];
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const tangent = { x: 0, z: 0 };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = spline.pointAt(t);
    spline.tangentInto(t, tangent);
    const normalX = -tangent.z;
    const normalZ = tangent.x;
    const half = halfWidthAt(corridor, t);

    centre.push({ x: point.x, z: point.z });
    left.push({ x: point.x + normalX * half, z: point.z + normalZ * half });
    right.push({ x: point.x - normalX * half, z: point.z - normalZ * half });
  }

  return { centre, left, right };
}
