/**
 * Cart paths (Stage 5): the paved lanes a golf course runs from the clubhouse round its holes, and
 * the one stretch of ground on the course that is faster than a fairway.
 *
 * **Where they come from.** Derived from the baked ground once per course, not authored: a seeded,
 * deterministic grid search (`planCartPaths`) over 4 m cells, which prices fairway high, refuses
 * water, sand, greens, tees, the road verge, steep banks and the clubhouse buildings, and prices
 * ground already paved low so later paths join earlier ones into a network instead of running
 * beside them. The legs are a real course's loop: the clubhouse to the 1st and 10th tees, each
 * hole from tee to green along its rough, each green to the next tee, and the 9th and 18th greens
 * back to the clubhouse (`PATH_LEGS`). See the Stage 5 spec, §2.
 *
 * **What they do.** `stampCartPaths` paints them into the baked grids (`courseGrids.ts`) as
 * `SurfaceId.Path`: every grid vertex within `PATH_HALF_WIDTH_M` of a path that was fairway or
 * rough becomes path, with the path's own tuning. The sim only ever reads the grids, so that is the
 * whole of the sim change. The renderer reads the polylines and lays a strip over them.
 *
 * DOM-free. Allocates freely while planning -- it runs once per course, at bake time -- and never
 * after.
 */
import type { Bounds } from "./courseLayout";
import type { SouthBoundary } from "./courseBarrier";
import { metresNorthOf } from "./courseBarrier";
import type { Obstacle } from "./lineOfSight";
import type { Vec2 } from "./mapGeometry";
import { SurfaceId } from "./surfaceId";
import type { Surfaces } from "./surfaces";
import type { Ellipse } from "./hazards";
import { toCourseFrame } from "./courseGeometry";
import type { CourseFrame } from "./courseGeometry";

/** Half the paved width. A cart is 1.2 m across; two pass on 4 m. */
export const PATH_HALF_WIDTH_M = 2;
/** The search grid's pitch. */
export const PATH_CELL_M = 4;
/** Steeper than this is a bank, not somewhere to pave: about 12°. */
export const PATH_MAX_GRADE = 0.21;
/**
 * Price of a cell in the band where fairway meets rough -- a cell of either with one of the other
 * beside it: the outer edge of the corridor's flat terrace, where a real course lays its path.
 * The cheapest unpaved ground. Beyond it the carved corridor's bank is often steeper than
 * `PATH_MAX_GRADE`.
 */
const COST_EDGE = 1;
/** Price of a cell of full rough, between holes or in the woods. */
const COST_ROUGH = 1.8;
/** Price of a cell of fairway: a path crosses one only where going round costs more. */
const COST_FAIRWAY = 10;
/** Price of a cell already paved: joins a network rather than doubling it. */
const COST_PAVED = 0.35;
/** Added per unit of grade squared, so a path takes the gentler way up a slope. */
const COST_GRADE = 40;
/** Cells this close to refused ground cost extra, so a smoothed path keeps its width off it. */
const COST_NEAR_REFUSED = 3;
/** Metres clear of the road a path keeps. */
const ROAD_CLEAR_M = 10;
/** Metres clear of a building's footprint. */
const BUILDING_CLEAR_M = 4;
/** A path ends this close to the tee it serves. */
export const TEE_REACH_M = 14;
/** And this close to the edge of the green. */
export const GREEN_REACH_M = 10;
/** The clubhouse end of a path: a ring round the front of the lot. */
export const CLUBHOUSE_FRONT_M = 42;
export const CLUBHOUSE_REACH_M = 16;

/** The ground the planner reads: the baked grids answer all of it. */
export interface PathGround {
  readonly bounds: Bounds;
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): SurfaceId;
}

/** One hole as the planner sees it, in the course frame. */
export interface PathHole {
  /** Zero-based course order. */
  readonly index: number;
  readonly tee: Vec2;
  /** The green's centre, and the radius of a circle that holds it. */
  readonly green: Vec2;
  readonly greenRadius: number;
}

export interface CartPathSource {
  readonly ground: PathGround;
  readonly holes: readonly PathHole[];
  readonly clubhouse: Vec2 | null;
  readonly southBoundary: SouthBoundary | null;
  /** Building footprints the paths go round. */
  readonly obstacles: readonly Obstacle[];
}

export type PathLegKind = "hole" | "link";

/** One polyline, as alternating x, z in the course frame. */
export interface CartPath {
  readonly kind: PathLegKind;
  /** What it joins, for the map and the tests: "h3" is hole 3's tee to green, "g3-t4" a link. */
  readonly name: string;
  readonly points: Float32Array;
}

type End = { readonly kind: "tee" | "green"; readonly hole: number } | { readonly kind: "clubhouse" };

interface Leg {
  readonly kind: PathLegKind;
  readonly name: string;
  readonly from: End;
  readonly to: End;
}

/**
 * The legs, in the order they are planned. Order matters: each leg is priced against the paving
 * of the ones before it, so the hole paths go first and the links join them.
 */
export function pathLegs(holeCount: number, clubhouse: boolean): Leg[] {
  const legs: Leg[] = [];
  for (let h = 0; h < holeCount; h++) {
    legs.push({ kind: "hole", name: `h${h + 1}`, from: { kind: "tee", hole: h }, to: { kind: "green", hole: h } });
  }
  const turn = Math.min(9, holeCount);
  for (let h = 0; h + 1 < holeCount; h++) {
    // The turn and the finish go back to the clubhouse; the 10th tee is reached from it.
    if (clubhouse && h + 1 === turn) continue;
    legs.push({ kind: "link", name: `g${h + 1}-t${h + 2}`, from: { kind: "green", hole: h }, to: { kind: "tee", hole: h + 1 } });
  }
  if (clubhouse) {
    legs.push({ kind: "link", name: "c-t1", from: { kind: "clubhouse" }, to: { kind: "tee", hole: 0 } });
    if (holeCount > turn) {
      legs.push({ kind: "link", name: `g${turn}-c`, from: { kind: "green", hole: turn - 1 }, to: { kind: "clubhouse" } });
      legs.push({ kind: "link", name: `c-t${turn + 1}`, from: { kind: "clubhouse" }, to: { kind: "tee", hole: turn } });
    }
    legs.push({ kind: "link", name: `g${holeCount}-c`, from: { kind: "green", hole: holeCount - 1 }, to: { kind: "clubhouse" } });
  }
  return legs;
}

/** A binary min-heap of cell indices keyed by a Float64 priority, ties broken by index. */
class CellHeap {
  private keys: Float64Array;
  private cells: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.cells = new Int32Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  private less(a: number, b: number): boolean {
    const ka = this.keys[a]!;
    const kb = this.keys[b]!;
    return ka < kb || (ka === kb && this.cells[a]! < this.cells[b]!);
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const c = this.cells[a]!;
    this.cells[a] = this.cells[b]!;
    this.cells[b] = c;
  }
  push(cell: number, key: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      const cells = new Int32Array(this.cells.length * 2);
      cells.set(this.cells);
      this.keys = keys;
      this.cells = cells;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.cells[i] = cell;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.cells[0]!;
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]!;
      this.cells[0] = this.cells[this.size]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const REFUSED = Infinity;

function insideObstacle(o: Obstacle, x: number, z: number, margin: number): boolean {
  const dx = x - o.x;
  const dz = z - o.z;
  // The obstacle's yaw turns its local X toward world X by (cos, sin); undo it.
  const lx = dx * o.cos - dz * o.sin;
  const lz = dx * o.sin + dz * o.cos;
  return Math.abs(lx) <= o.halfX + margin && Math.abs(lz) <= o.halfZ + margin;
}

/**
 * Plans every leg. Deterministic: the same ground gives the same paths on every machine, because
 * the search is integer-ordered (ties go to the lower cell index) and reads nothing but the ground.
 */
export function planCartPaths(source: CartPathSource): CartPath[] {
  const { ground, holes, clubhouse, southBoundary, obstacles } = source;
  const { bounds } = ground;
  const cols = Math.floor((bounds.maxX - bounds.minX) / PATH_CELL_M);
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / PATH_CELL_M);
  const count = cols * rows;
  const cx = (c: number): number => bounds.minX + (c + 0.5) * PATH_CELL_M;
  const cz = (r: number): number => bounds.minZ + (r + 0.5) * PATH_CELL_M;

  // Each cell's surface: fairway, rough, or anything else (refused).
  const FAIRWAY = 1;
  const ROUGH = 2;
  const kind = new Uint8Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = ground.surfaceAt(cx(c), cz(r));
      kind[r * cols + c] = s === SurfaceId.Fairway ? FAIRWAY : s === SurfaceId.Rough ? ROUGH : 0;
    }
  }
  // A cell's centre is not enough: a bunker smaller than a cell can sit 2 m to one side of it, under
  // the paved width. Refusal is sampled on a lattice twice as fine and a cell refused if any fine
  // sample within `FINE_REACH` of it is -- about 4 to 5 m of its centre, which holds the paved
  // half width and the smoothing's drift.
  const FINE_REACH = 2;
  const fcols = cols * 2;
  const frows = rows * 2;
  const fineRefused = new Uint8Array(fcols * frows);
  for (let r = 0; r < frows; r++) {
    for (let c = 0; c < fcols; c++) {
      const s = ground.surfaceAt(bounds.minX + (c + 0.5) * (PATH_CELL_M / 2), bounds.minZ + (r + 0.5) * (PATH_CELL_M / 2));
      if (s !== SurfaceId.Fairway && s !== SurfaceId.Rough) fineRefused[r * fcols + c] = 1;
    }
  }
  const nearRefused = (r: number, c: number): boolean => {
    for (let fr = r * 2 - FINE_REACH; fr <= r * 2 + 1 + FINE_REACH; fr++) {
      if (fr < 0 || fr >= frows) continue;
      for (let fc = c * 2 - FINE_REACH; fc <= c * 2 + 1 + FINE_REACH; fc++) {
        if (fc >= 0 && fc < fcols && fineRefused[fr * fcols + fc]) return true;
      }
    }
    return false;
  };
  /** Fairway beside rough, or rough beside fairway: the band where one grades into the other. */
  const onEdge = (r: number, c: number): boolean => {
    const own = kind[r * cols + c]!;
    const other = own === FAIRWAY ? ROUGH : FAIRWAY;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && kind[rr * cols + cc] === other) return true;
      }
    }
    return false;
  };

  // The price of standing in each cell, before paving.
  const base = new Float64Array(count);
  const refused = new Uint8Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = cx(c);
      const z = cz(r);
      const k = kind[i]!;
      let price: number;
      if (k === 0 || nearRefused(r, c)) price = REFUSED;
      else if (onEdge(r, c)) price = COST_EDGE;
      else price = k === ROUGH ? COST_ROUGH : COST_FAIRWAY;
      if (southBoundary && metresNorthOf(southBoundary, x, z) < ROAD_CLEAR_M) price = REFUSED;
      for (const o of obstacles) if (insideObstacle(o, x, z, BUILDING_CLEAR_M)) price = REFUSED;
      if (price !== REFUSED) {
        const h = PATH_CELL_M / 2;
        const gx = (ground.heightAt(x + h, z) - ground.heightAt(x - h, z)) / PATH_CELL_M;
        const gz = (ground.heightAt(x, z + h) - ground.heightAt(x, z - h)) / PATH_CELL_M;
        const grade2 = gx * gx + gz * gz;
        if (grade2 > PATH_MAX_GRADE * PATH_MAX_GRADE) price = REFUSED;
        else price += COST_GRADE * grade2;
      }
      base[i] = price;
      if (price === REFUSED) refused[i] = 1;
    }
  }
  // A margin round refused ground, so the paved width stays off it.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (refused[i]) continue;
      let near = false;
      for (let dr = -1; dr <= 1 && !near; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || refused[rr * cols + cc]) {
            near = true;
            break;
          }
        }
      }
      if (near) base[i] = base[i]! + COST_NEAR_REFUSED;
    }
  }

  const paved = new Uint8Array(count);
  const dist = new Float64Array(count);
  const from = new Int32Array(count);
  const goal = new Uint8Array(count);
  const heap = new CellHeap(1 << 14);
  const front = clubhouse ? { x: clubhouse.x, z: clubhouse.z + CLUBHOUSE_FRONT_M } : null;

  /** Marks the cells an end reaches; returns how many. */
  function markEnd(end: End, into: Uint8Array): number {
    into.fill(0);
    let centre: Vec2;
    let reach: number;
    if (end.kind === "clubhouse") {
      centre = front!;
      reach = CLUBHOUSE_REACH_M;
    } else {
      const hole = holes[end.hole]!;
      centre = end.kind === "tee" ? hole.tee : hole.green;
      reach = end.kind === "tee" ? TEE_REACH_M : hole.greenRadius + GREEN_REACH_M;
    }
    let n = 0;
    const c0 = Math.max(0, Math.floor((centre.x - reach - bounds.minX) / PATH_CELL_M));
    const c1 = Math.min(cols - 1, Math.ceil((centre.x + reach - bounds.minX) / PATH_CELL_M));
    const r0 = Math.max(0, Math.floor((centre.z - reach - bounds.minZ) / PATH_CELL_M));
    const r1 = Math.min(rows - 1, Math.ceil((centre.z + reach - bounds.minZ) / PATH_CELL_M));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        if (refused[i]) continue;
        if (Math.hypot(cx(c) - centre.x, cz(r) - centre.z) <= reach) {
          into[i] = 1;
          n++;
        }
      }
    }
    return n;
  }

  const starts = new Uint8Array(count);
  const DIAG = Math.SQRT2;
  const STEPS: readonly (readonly [number, number, number])[] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
  ];

  const paths: CartPath[] = [];
  for (const leg of pathLegs(holes.length, clubhouse !== null)) {
    if (markEnd(leg.from, starts) === 0 || markEnd(leg.to, goal) === 0) continue;
    // Dijkstra from every start cell at once: the path begins wherever round the tee is best.
    dist.fill(Infinity);
    from.fill(-1);
    heap.clear();
    for (let i = 0; i < count; i++) {
      if (!starts[i]) continue;
      dist[i] = 0;
      heap.push(i, 0);
    }
    let reached = -1;
    while (heap.size > 0) {
      const i = heap.pop();
      if (goal[i]) {
        reached = i;
        break;
      }
      const d = dist[i]!;
      const r = Math.floor(i / cols);
      const c = i - r * cols;
      for (const [dc, dr, len] of STEPS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (refused[j]) continue;
        // A diagonal may not cut the corner of refused ground.
        if (dr !== 0 && dc !== 0 && (refused[r * cols + cc] || refused[rr * cols + c])) continue;
        const price = paved[j] ? COST_PAVED : base[j]!;
        const nd = d + price * len;
        if (nd < dist[j]!) {
          dist[j] = nd;
          from[j] = i;
          heap.push(j, nd);
        }
      }
    }
    if (reached < 0) continue;

    const cells: number[] = [];
    for (let i = reached; i >= 0; i = from[i]!) cells.push(i);
    cells.reverse();
    for (const i of cells) paved[i] = 1;
    paths.push({ kind: leg.kind, name: leg.name, points: smooth(cells) });
  }
  return paths;

  /**
   * Cell centres to a polyline: every other cell kept, then two rounds of corner cutting. A cut
   * corner moves at most a quarter of a cell's diagonal off the searched line, which the margin
   * round refused ground covers.
   */
  function smooth(cells: readonly number[]): Float32Array {
    let pts: number[] = [];
    for (let k = 0; k < cells.length; k++) {
      if (k % 2 === 1 && k !== cells.length - 1) continue;
      const i = cells[k]!;
      const r = Math.floor(i / cols);
      pts.push(cx(i - r * cols), cz(r));
    }
    for (let round = 0; round < 2; round++) {
      if (pts.length < 6) break;
      const next: number[] = [pts[0]!, pts[1]!];
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k]!, az = pts[k + 1]!, bx = pts[k + 2]!, bz = pts[k + 3]!;
        next.push(0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz, 0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz);
      }
      next.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
      pts = next;
    }
    return new Float32Array(pts);
  }
}

/** Calls `visit(x, z, distance)` for every lattice point within `radius` of any path segment. */
function forEachNear(
  paths: readonly CartPath[],
  radius: number,
  lattice: { minX: number; minZ: number; step: number; cols: number; rows: number },
  visit: (col: number, row: number, distance: number) => void,
): void {
  const { minX, minZ, step, cols, rows } = lattice;
  for (const path of paths) {
    const pts = path.points;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!;
      const az = pts[k + 1]!;
      const bx = pts[k + 2]!;
      const bz = pts[k + 3]!;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - minX) / step));
      const c1 = Math.min(cols, Math.ceil((Math.max(ax, bx) + radius - minX) / step));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - radius - minZ) / step));
      const r1 = Math.min(rows, Math.ceil((Math.max(az, bz) + radius - minZ) / step));
      for (let r = r0; r <= r1; r++) {
        const z = minZ + r * step;
        for (let c = c0; c <= c1; c++) {
          const x = minX + c * step;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
          const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          if (d <= radius) visit(c, r, d);
        }
      }
    }
  }
}

/** The grid arrays `stampCartPaths` paints: `courseGrids.ts`' `CourseGrids`, structurally. */
export interface StampableGrids {
  readonly bounds: Bounds;
  readonly cols: number;
  readonly rows: number;
  readonly surface: Uint8Array;
  readonly rolling: Float32Array;
  readonly bounceScale: Float32Array;
  readonly cartSpeedScale: Float32Array;
}

/**
 * Paints the paths into the baked grids: every vertex within `PATH_HALF_WIDTH_M` of a path that
 * was fairway or rough becomes `SurfaceId.Path` with the path's tuning. Returns how many vertices
 * it painted. `codes` and `tuning` are `SURFACE_CODES` and `SURFACES`, passed in so this module
 * stays upstream of `surfaces.ts`.
 */
export function stampCartPaths(
  grids: StampableGrids,
  paths: readonly CartPath[],
  codes: readonly SurfaceId[],
  path: { readonly rolling: number; readonly bounceScale: number; readonly cartSpeedScale: number },
): number {
  const { bounds, cols, rows } = grids;
  const stride = rows + 1;
  const fairway = codes.indexOf(SurfaceId.Fairway);
  const rough = codes.indexOf(SurfaceId.Rough);
  const paved = codes.indexOf(SurfaceId.Path);
  const step = (bounds.maxX - bounds.minX) / cols;
  // The grids are square-celled (`COURSE_CELL_M` both ways), which the lattice below assumes.
  let painted = 0;
  forEachNear(paths, PATH_HALF_WIDTH_M, { minX: bounds.minX, minZ: bounds.minZ, step, cols, rows }, (col, row) => {
    const i = row + col * stride;
    const code = grids.surface[i]!;
    if (code !== fairway && code !== rough) return;
    grids.surface[i] = paved;
    grids.rolling[i] = path.rolling;
    grids.bounceScale[i] = path.bounceScale;
    grids.cartSpeedScale[i] = path.cartSpeedScale;
    painted++;
  });
  return painted;
}

/** Metres a mask cell spans. */
export const PATH_MASK_CELL_M = 1;
/**
 * How far either side of a path the renderer keeps clear: the paved half width and a verge, so a
 * tree's crown or a tuft does not stand on the concrete.
 */
export const PATH_CLEAR_M = PATH_HALF_WIDTH_M + 1;

/** A 1 m raster of where the paths are, for render-side placement and the map. */
export interface CartPathMask {
  /** True within `PATH_CLEAR_M` of a path. */
  at(x: number, z: number): boolean;
}

export function rasterizeCartPaths(paths: readonly CartPath[], bounds: Bounds): CartPathMask {
  const step = PATH_MASK_CELL_M;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / step);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / step);
  const bits = new Uint8Array((cols + 1) * (rows + 1));
  forEachNear(paths, PATH_CLEAR_M, { minX: bounds.minX, minZ: bounds.minZ, step, cols, rows }, (c, r) => {
    bits[r * (cols + 1) + c] = 1;
  });
  return {
    at(x, z) {
      const c = Math.round((x - bounds.minX) / step);
      const r = Math.round((z - bounds.minZ) / step);
      if (c < 0 || r < 0 || c > cols || r > rows) return false;
      return bits[r * (cols + 1) + c] === 1;
    },
  };
}

/**
 * The renderer's surfaces with the paths on them: `surfaceAt` answers `Path` within
 * `PATH_CLEAR_M` of a path that crosses fairway or rough. Woods placement and grass tufts plant
 * only on rough, so they keep off the paths through this alone, and the map colours them. Tuning
 * and weights pass through: the ground is drawn from the weights and the strip covers it.
 */
export function withCartPaths(surfaces: Surfaces, mask: CartPathMask): Surfaces {
  return {
    surfaceAt(x, z) {
      const base = surfaces.surfaceAt(x, z);
      if ((base === SurfaceId.Fairway || base === SurfaceId.Rough) && mask.at(x, z)) return SurfaceId.Path;
      return base;
    },
    tuningAt: (x, z, out) => surfaces.tuningAt(x, z, out),
    weightsAt: (x, z, out) => surfaces.weightsAt(x, z, out),
  };
}

/** The course's holes as the planner wants them: course order, tee and green in the course frame. */
export function pathHoles(
  holes: readonly {
    readonly placement: CourseFrame;
    readonly spec: { readonly index: number; readonly tee: Vec2; readonly green: Ellipse };
  }[],
): PathHole[] {
  return [...holes]
    .sort((a, b) => a.spec.index - b.spec.index)
    .map((h) => {
      const tee = { x: 0, z: 0 };
      const green = { x: 0, z: 0 };
      toCourseFrame(h.placement, h.spec.tee.x, h.spec.tee.z, tee);
      toCourseFrame(h.placement, h.spec.green.x, h.spec.green.z, green);
      return { index: h.spec.index, tee, green, greenRadius: Math.max(h.spec.green.radiusX, h.spec.green.radiusZ) };
    });
}
