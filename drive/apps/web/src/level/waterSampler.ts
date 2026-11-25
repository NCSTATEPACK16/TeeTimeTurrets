import type { CourseJson } from '@gcs/level-schema';
import type { HeightSampler } from './heightSampler';

export interface WaterHit {
  id: string;
  /** Water surface height, m. */
  level: number;
  /** Water surface minus ground height, m; zero or negative on dry ground inside the outline. */
  depth: number;
}

interface Body {
  id: string;
  level: number;
  polygon: readonly [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Physics-side water lookup. Water is not a collider: the cart drives on the bed, and this
 * says how deep the water is above any point. Bodies come from course.water[] outlines.
 */
export class WaterSampler {
  private readonly bodies: Body[];

  constructor(
    water: CourseJson['water'],
    private readonly heights: HeightSampler,
  ) {
    this.bodies = water.map((w) => {
      const xs = w.polygon.map((p) => p[0]);
      const zs = w.polygon.map((p) => p[1]);
      return {
        id: w.id,
        level: w.level,
        polygon: w.polygon,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
    });
  }

  /** The water body whose outline holds (x, z) with water above the ground, or null. */
  at(x: number, z: number): WaterHit | null {
    for (const b of this.bodies) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (!pointInPolygon(b.polygon, x, z)) continue;
      const depth = b.level - this.heights.heightAt(x, z);
      if (depth > 0) return { id: b.id, level: b.level, depth };
    }
    return null;
  }

  /** Water depth at (x, z), 0 when dry. */
  depthAt(x: number, z: number): number {
    return this.at(x, z)?.depth ?? 0;
  }
}

/** Even-odd ray casting. */
export function pointInPolygon(poly: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
