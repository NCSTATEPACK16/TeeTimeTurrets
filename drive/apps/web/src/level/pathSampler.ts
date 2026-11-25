import type { PathsJson, Pose } from '@gcs/level-schema';

export interface PathPoint {
  pathId: string;
  x: number;
  z: number;
  /** Compass heading along the path's point order at the nearest point. */
  headingDeg: number;
  distance: number;
}

/** Nearest-point lookup over cart path centerlines (paths.json). Used to respawn the cart. */
export class PathSampler {
  constructor(private readonly paths: PathsJson['paths']) {}

  nearest(x: number, z: number): PathPoint | null {
    let best: PathPoint | null = null;
    let bestD2 = Infinity;
    for (const path of this.paths) {
      const pts = path.points;
      const n = pts.length;
      const segs = path.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const [ax, , az] = pts[i]!;
        const [bx, , bz] = pts[(i + 1) % n]!;
        const ex = bx - ax;
        const ez = bz - az;
        const len2 = ex * ex + ez * ez;
        if (len2 === 0) continue;
        const t = Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / len2, 0), 1);
        const px = ax + t * ex;
        const pz = az + t * ez;
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          const heading = ((Math.atan2(ex, -ez) * 180) / Math.PI + 360) % 360;
          best = { pathId: path.id, x: px, z: pz, headingDeg: heading, distance: 0 };
        }
      }
    }
    if (best) best.distance = Math.sqrt(bestD2);
    return best;
  }

  /** Respawn pose on the nearest path, or null when the level has no paths. */
  nearestPose(x: number, z: number): Pose | null {
    const p = this.nearest(x, z);
    return p ? { x: p.x, z: p.z, headingDeg: p.headingDeg } : null;
  }
}
