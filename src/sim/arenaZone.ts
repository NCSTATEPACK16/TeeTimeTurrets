import { toCourseFrame } from "./courseLayout";
import type { Bounds } from "./courseLayout";
import { metresNorthOf } from "./courseBarrier";
import type { SouthBoundary } from "./courseBarrier";
import type { Vec2 } from "./mapGeometry";
import type { PlacedHole } from "./courseTerrain";
import { halfWidthAt } from "./terrain";

/**
 * The arena zone (#52): the part of the course a match is fought on, holes 1, 9, 10, 14, 15 and 18
 * around the clubhouse (`docs/REVAMP-PLAN.md` Stage 4).
 *
 * **The shape** is the union of the six holes' corridors, each padded by `ZONE_PAD_M`, and a hub
 * joining them to the clubhouse: the convex hull of a disc round the clubhouse and the ends of
 * those six holes that come back to it. It is held north of the road and inside the ground.
 *
 * **How it is built.** Exact polygon union of curved corridors is fiddly and nothing here needs
 * it. Instead the union is a field -- positive inside, the signed distance to each shape combined
 * with max for union and min for intersection -- sampled on a `ZONE_CELL_M` grid, and its zero line
 * is traced with marching squares into closed loops. The largest loop is the zone; a pocket of rough
 * the corridors ring round (an inner loop) counts as inside. The loop is simplified to within
 * `ZONE_SIMPLIFY_M`. That runs once per course in a few tens of milliseconds.
 *
 * **What it does in a match** (`world.ts`): a cart outside it is warned at once and loses
 * `ZONE_DRAIN_HP` every `ZONE_DRAIN_INTERVAL_S`; it cannot get more than `ZONE_HARD_LIMIT_M` out;
 * and a bot only ever drives at points inside it.
 *
 * Pure and allocation-free after construction: `contains` and `nearestEdge` run per cart per tick.
 */

/** Hole indices, zero-based: holes 1, 9, 10, 14, 15 and 18. */
export const ZONE_HOLE_INDICES: readonly number[] = [0, 8, 9, 13, 14, 17];
/** Beyond each corridor's own half-width. A corridor is ~15-19 m half-wide, so this is ~40 m of playable ground either side of the centreline. */
export const ZONE_PAD_M = 22;
/** The clubhouse pad: the complex, both barns and the team pads (each about 30 m out). */
export const ZONE_HUB_RADIUS_M = 60;
/** A zone hole's tee or cup this close to the clubhouse joins the hub, so the hub reaches it. */
export const ZONE_HUB_REACH_M = 170;
/** The hard clamp: the furthest out of the zone a cart can get. */
export const ZONE_HARD_LIMIT_M = 30;
export const ZONE_DRAIN_INTERVAL_S = 2;
export const ZONE_DRAIN_HP = 1;
/** How far inside the edge a bot's clamped target is put, so it is not driving at the line itself. */
export const ZONE_TARGET_INSET_M = 6;
/** The zone stays this far north of the road, and this far inside the ground's box. */
const ZONE_ROAD_INSET_M = 8;
const ZONE_BOUNDS_INSET_M = 10;
const ZONE_CELL_M = 4;
const ZONE_SIMPLIFY_M = 1;
/** Corridor centreline samples per metre of hole. */
const CENTRELINE_STEP_M = 4;

export interface ZoneSource {
  /** The course's holes; only `ZONE_HOLE_INDICES` are used. */
  readonly holes: readonly PlacedHole[];
  readonly clubhouse: Vec2;
  readonly southBoundary: SouthBoundary | null;
  readonly bounds: Bounds;
}

export class ArenaZone {
  /** The edge, counter-clockwise, in course-frame metres. The render's stakes stand on it. */
  readonly polygon: readonly Vec2[];
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;

  constructor(polygon: readonly Vec2[]) {
    if (polygon.length < 3) throw new Error("ArenaZone: a polygon needs at least three points");
    this.polygon = polygon;
    this.xs = Float64Array.from(polygon, (p) => p.x);
    this.zs = Float64Array.from(polygon, (p) => p.z);
  }

  /** Even-odd ray cast. */
  contains(x: number, z: number): boolean {
    const xs = this.xs;
    const zs = this.zs;
    let inside = false;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      const zi = zs[i]!;
      const zj = zs[j]!;
      if (zi > z !== zj > z && x < ((xs[j]! - xs[i]!) * (z - zi)) / (zj - zi) + xs[i]!) inside = !inside;
    }
    return inside;
  }

  /** The nearest point of the edge, written into `out`; returns the distance to it. */
  nearestEdge(x: number, z: number, out: { x: number; z: number }): number {
    const xs = this.xs;
    const zs = this.zs;
    let best = Infinity;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      const ax = xs[j]!;
      const az = zs[j]!;
      const dx = xs[i]! - ax;
      const dz = zs[i]! - az;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        out.x = px;
        out.z = pz;
      }
    }
    return best;
  }

  /** 0 inside; outside, the distance to the edge. `scratch` receives the nearest edge point. */
  distanceOutside(x: number, z: number, scratch: { x: number; z: number }): number {
    if (this.contains(x, z)) return 0;
    return this.nearestEdge(x, z, scratch);
  }

  /**
   * A point outside by more than `limit` pulled back to `limit` out, toward the nearest edge point.
   * Writes the result into `out` (which may alias nothing else); returns whether it moved.
   */
  clampWithin(x: number, z: number, limit: number, out: { x: number; z: number }): boolean {
    out.x = x;
    out.z = z;
    if (this.contains(x, z)) return false;
    const d = this.nearestEdge(x, z, this.edgeScratch);
    if (d <= limit) return false;
    const k = limit / d;
    out.x = this.edgeScratch.x + (x - this.edgeScratch.x) * k;
    out.z = this.edgeScratch.z + (z - this.edgeScratch.z) * k;
    return true;
  }

  /**
   * A point outside moved to `ZONE_TARGET_INSET_M` inside the nearest edge; a point inside left
   * alone. For bot targets. Writes into `out`; returns whether it moved.
   */
  clampInside(x: number, z: number, out: { x: number; z: number }): boolean {
    out.x = x;
    out.z = z;
    if (this.contains(x, z)) return false;
    const d = this.nearestEdge(x, z, this.edgeScratch);
    const ex = this.edgeScratch.x;
    const ez = this.edgeScratch.z;
    // Past the edge along the line from the point, which is inward at the nearest edge point.
    const k = d > 1e-9 ? ZONE_TARGET_INSET_M / d : 0;
    out.x = ex + (ex - x) * k;
    out.z = ez + (ez - z) * k;
    return true;
  }

  private readonly edgeScratch = { x: 0, z: 0 };
}

/** One zone hole's corridor centreline in course frame, with each sample's padded radius. */
interface Chain {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly rs: Float64Array;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

function chainFor(hole: PlacedHole): Chain {
  const spline = hole.terrain.spline;
  const n = Math.max(2, Math.ceil(spline.length / CENTRELINE_STEP_M) + 1);
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const rs = new Float64Array(n);
  const p = { x: 0, z: 0 };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const local = spline.pointAt(t);
    toCourseFrame(hole.placement, local.x, local.z, p);
    xs[i] = p.x;
    zs[i] = p.z;
    rs[i] = halfWidthAt(hole.spec.corridor, t) + ZONE_PAD_M;
    maxR = Math.max(maxR, rs[i]!);
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { xs, zs, rs, minX: minX - maxR, minZ: minZ - maxR, maxX: maxX + maxR, maxZ: maxZ + maxR };
}

/** Radius minus distance to the chain, with the radius interpolated along each segment. */
function chainField(chain: Chain, x: number, z: number): number {
  if (x < chain.minX - 50 || x > chain.maxX + 50 || z < chain.minZ - 50 || z > chain.maxZ + 50) return -50;
  let best = -Infinity;
  const { xs, zs, rs } = chain;
  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1]!;
    const az = zs[i - 1]!;
    const dx = xs[i]! - ax;
    const dz = zs[i]! - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
    const r = rs[i - 1]! + (rs[i]! - rs[i - 1]!) * t;
    const value = r - Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (value > best) best = value;
  }
  return best;
}

/** Andrew's monotone chain; counter-clockwise, no repeated end point. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Signed distance to the lines of a counter-clockwise convex polygon's edges: positive inside. */
function hullField(hull: readonly Vec2[], x: number, z: number): number {
  let value = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    // Left of a->b is inside for a counter-clockwise polygon.
    const d = (dx * (z - a.z) - dz * (x - a.x)) / Math.hypot(dx, dz);
    if (d < value) value = d;
  }
  return value;
}

function circle(centre: Vec2, radius: number, points: number, out: Vec2[]): void {
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    out.push({ x: centre.x + Math.cos(a) * radius, z: centre.z + Math.sin(a) * radius });
  }
}

/** The zone for a course. See the module comment for the shape and how it is traced. */
export function buildArenaZone(source: ZoneSource): ArenaZone {
  const wanted = new Set(ZONE_HOLE_INDICES);
  const holes = source.holes.filter((h) => wanted.has(h.spec.index));
  if (holes.length === 0) throw new Error("buildArenaZone: none of the zone's holes is on this course");
  const chains = holes.map(chainFor);

  const hubPoints: Vec2[] = [];
  circle(source.clubhouse, ZONE_HUB_RADIUS_M, 24, hubPoints);
  for (const chain of chains) {
    for (const i of [0, chain.xs.length - 1]) {
      const end = { x: chain.xs[i]!, z: chain.zs[i]! };
      if (Math.hypot(end.x - source.clubhouse.x, end.z - source.clubhouse.z) > ZONE_HUB_REACH_M) continue;
      circle(end, chain.rs[i]!, 16, hubPoints);
    }
  }
  const hub = convexHull(hubPoints);

  const { bounds, southBoundary } = source;
  const field = (x: number, z: number): number => {
    let f = hullField(hub, x, z);
    for (const chain of chains) f = Math.max(f, chainField(chain, x, z));
    if (southBoundary !== null) f = Math.min(f, metresNorthOf(southBoundary, x, z) - ZONE_ROAD_INSET_M);
    f = Math.min(
      f,
      x - bounds.minX - ZONE_BOUNDS_INSET_M,
      bounds.maxX - x - ZONE_BOUNDS_INSET_M,
      z - bounds.minZ - ZONE_BOUNDS_INSET_M,
      bounds.maxZ - z - ZONE_BOUNDS_INSET_M,
    );
    return f;
  };

  // The grid covers every shape with two cells of outside all round, so every loop closes.
  let minX = Math.min(...hub.map((p) => p.x));
  let maxX = Math.max(...hub.map((p) => p.x));
  let minZ = Math.min(...hub.map((p) => p.z));
  let maxZ = Math.max(...hub.map((p) => p.z));
  for (const c of chains) {
    minX = Math.min(minX, c.minX);
    maxX = Math.max(maxX, c.maxX);
    minZ = Math.min(minZ, c.minZ);
    maxZ = Math.max(maxZ, c.maxZ);
  }
  minX -= 2 * ZONE_CELL_M;
  minZ -= 2 * ZONE_CELL_M;
  const nx = Math.ceil((maxX + 2 * ZONE_CELL_M - minX) / ZONE_CELL_M) + 1;
  const nz = Math.ceil((maxZ + 2 * ZONE_CELL_M - minZ) / ZONE_CELL_M) + 1;
  const values = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) values[j * nx + i] = field(minX + i * ZONE_CELL_M, minZ + j * ZONE_CELL_M);
  }

  const loop = largestLoop(values, nx, nz, minX, minZ, ZONE_CELL_M);
  const simplified = simplifyClosed(loop, ZONE_SIMPLIFY_M);
  if (signedArea(simplified) < 0) simplified.reverse();
  return new ArenaZone(simplified);
}

/**
 * Marching squares on the zero line of `values` (nodes on a regular grid), chained into closed loops;
 * returns the loop enclosing the most area. Each crossing is keyed by the grid edge it lies on, and
 * every crossing edge is shared by exactly two cells, so each crossing joins exactly two segments.
 */
function largestLoop(values: Float64Array, nx: number, nz: number, x0: number, z0: number, cell: number): Vec2[] {
  const point = new Map<number, Vec2>();
  const links = new Map<number, number[]>();
  const at = (i: number, j: number): number => values[j * nx + i]!;
  /** Edge ids: 2*node for the edge to the +x neighbour, 2*node+1 for the edge to the +z one. */
  const crossing = (i: number, j: number, alongX: boolean): number => {
    const id = 2 * (j * nx + i) + (alongX ? 0 : 1);
    if (!point.has(id)) {
      const a = at(i, j);
      const b = alongX ? at(i + 1, j) : at(i, j + 1);
      const t = a / (a - b);
      point.set(id, alongX ? { x: x0 + (i + t) * cell, z: z0 + j * cell } : { x: x0 + i * cell, z: z0 + (j + t) * cell });
    }
    return id;
  };
  const link = (a: number, b: number): void => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = at(i, j) > 0;
      const v10 = at(i + 1, j) > 0;
      const v11 = at(i + 1, j + 1) > 0;
      const v01 = at(i, j + 1) > 0;
      // The four sides that change sign, by id; a cell has 0, 2 or 4 of them.
      const sides: number[] = [];
      if (v00 !== v10) sides.push(crossing(i, j, true)); // bottom
      if (v10 !== v11) sides.push(crossing(i + 1, j, false)); // right
      if (v01 !== v11) sides.push(crossing(i, j + 1, true)); // top
      if (v00 !== v01) sides.push(crossing(i, j, false)); // left
      if (sides.length === 2) link(sides[0]!, sides[1]!);
      else if (sides.length === 4) {
        // A saddle: the centre's sign decides which corners connect.
        const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
        if (centre === v00) {
          link(sides[0]!, sides[1]!);
          link(sides[2]!, sides[3]!);
        } else {
          link(sides[0]!, sides[3]!);
          link(sides[1]!, sides[2]!);
        }
      }
    }
  }

  const visited = new Set<number>();
  let best: Vec2[] = [];
  let bestArea = 0;
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop: Vec2[] = [];
    let previous = -1;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(point.get(current)!);
      const next = links.get(current)!.find((n) => n !== previous && !visited.has(n));
      previous = current;
      if (next === undefined) break;
      current = next;
    }
    const area = Math.abs(signedArea(loop));
    if (area > bestArea) {
      bestArea = area;
      best = loop;
    }
  }
  if (best.length < 3) throw new Error("buildArenaZone: the zone traced to nothing");
  return best;
}

/** Shoelace; positive counter-clockwise (x right, z up). */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += poly[j]!.x * poly[i]!.z - poly[i]!.x * poly[j]!.z;
  }
  return sum / 2;
}

/** Douglas-Peucker on a closed loop, split at its first point and the point furthest from it. */
function simplifyClosed(loop: readonly Vec2[], tolerance: number): Vec2[] {
  const first = loop[0]!;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i]!.x - first.x, loop[i]!.z - first.z);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(loop.slice(0, far + 1), tolerance);
  const b = simplifyOpen([...loop.slice(far), first], tolerance);
  return a.concat(b.slice(1, -1));
}

function simplifyOpen(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return [...points];
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = length > 0 ? Math.abs(dx * (p.z - a.z) - dz * (p.x - a.x)) / length : Math.hypot(p.x - a.x, p.z - a.z);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplifyOpen(points.slice(0, index + 1), tolerance);
  const right = simplifyOpen(points.slice(index), tolerance);
  return left.concat(right.slice(1));
}
