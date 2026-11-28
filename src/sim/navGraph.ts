/**
 * The bots' navigation graph (Stage 6, `docs/superpowers/specs/2026-11-28-stage-6-navgraph-design.md`):
 * a grid over the arena zone, and A* across it.
 *
 * Adapted in shape from the vendored Claude of Tanks planner (`src/vendor/cot/botRoutePlanner.ts`,
 * MIT, see `NOTICE`): a grid, 8-connected steps with sqrt 2 diagonals, a binary min-heap and an
 * octile heuristic. What is ours: the extent and cell size are the zone's, passability and cost come
 * from this game's mobility table (`mobility.ts`), and every per-plan buffer is allocated once, so a
 * plan allocates nothing inside the fixed tick. No randomness: ties break on cell index, so a plan is
 * the same on every machine.
 *
 * DOM-free and Rapier-free.
 */
import type { Bounds } from "./courseLayout";
import { CART_HULL, CART_TUNING, TIRE_TUNING, TireType } from "./entities/Cart";
import type { Obstacle } from "./lineOfSight";
import { maxClimbRad, resistanceFromSpeedScale, tireResistance } from "./mobility";
import { SurfaceId } from "./surfaceId";
import { createSurfaceTuning } from "./surfaces";
import type { Surfaces } from "./surfaces";

/** Cell pitch (§2.1, Q1): the cart paths' pitch, about twice the hull's width. */
export const NAV_CELL_M = 4;
/** How far out from a cell's centre its four edge samples sit. */
const SAMPLE_OUT_M = 1.2;
/** Share of the climb limit a route may use (§2.2, Q2). */
export const NAV_CLIMB_MARGIN = 0.8;
/** Cost per unit grade squared. */
const GRADE_COST = 4;
/** Cost added beside a refused cell, so routes do not shave pond edges. */
const NEAR_REFUSED_COST = 1.5;
/** Metres beyond the hull a building is grown by. */
const OBSTACLE_PAD_M = 1;
/** Rings searched for a passable cell when a start or goal is refused. */
const SNAP_RINGS = 3;
/** Nodes A* may expand before giving up (§2.3, Q4). */
export const NAV_MAX_EXPANSIONS = 20_000;
/** Waypoints a route holds (§2.3). */
export const NAV_ROUTE_CAPACITY = 64;
/**
 * The line walk's step. With every passable cell inside the zone by `ZONE_MARGIN_M` and samples this
 * close, no point of a clear line is more than half a step from a sample, so none leaves the zone.
 */
const LINE_STEP_M = 1;
/** How far inside the zone a whole cell must lie for it to count. */
const ZONE_MARGIN_M = 1;

const SQRT2 = Math.SQRT2;
const STEP_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** What the graph is built from: the sim's own ground, the zone, and the clubhouse's buildings. */
export interface NavSource {
  heightAt(x: number, z: number): number;
  readonly surfaces: Pick<Surfaces, "surfaceAt" | "tuningAt">;
  readonly zone: { contains(x: number, z: number): boolean; readonly polygon: readonly { readonly x: number; readonly z: number }[] };
  readonly obstacles: readonly Obstacle[];
}

/** A planned route: up to `NAV_ROUTE_CAPACITY` waypoints as x, z pairs, the goal last. Reused. */
export interface NavRoute {
  readonly points: Float32Array;
  count: number;
}

export function createNavRoute(): NavRoute {
  return { points: new Float32Array(NAV_ROUTE_CAPACITY * 2), count: 0 };
}

export class NavGraph {
  readonly cols: number;
  readonly rows: number;
  readonly minX: number;
  readonly minZ: number;
  /** 1 where a cart may drive, by cell index `col + row * cols`. */
  readonly passable: Uint8Array;
  /** Cost per metre of entering each cell; meaningless where refused. */
  readonly cost: Float32Array;
  /** The cheapest cost per metre of any passable cell: the heuristic's scale, so it never overestimates. */
  private readonly minCost: number;

  // Per-plan scratch, sized once.
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  private readonly heapCell: Int32Array;
  private readonly heapKey: Float64Array;
  private heapSize = 0;
  private readonly chain: Int32Array;

  constructor(source: NavSource) {
    const b = boundsOf(source.zone.polygon);
    this.minX = b.minX - NAV_CELL_M;
    this.minZ = b.minZ - NAV_CELL_M;
    this.cols = Math.ceil((b.maxX - b.minX) / NAV_CELL_M) + 3;
    this.rows = Math.ceil((b.maxZ - b.minZ) / NAV_CELL_M) + 3;
    const n = this.cols * this.rows;
    this.passable = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    // Lazy insertion: a node may be pushed once per improving neighbour, at most eight times per expansion.
    this.heapCell = new Int32Array(NAV_MAX_EXPANSIONS * 8 + 16);
    this.heapKey = new Float64Array(NAV_MAX_EXPANSIONS * 8 + 16);
    this.chain = new Int32Array(n);

    const tire = TIRE_TUNING[TireType.Street];
    const tuning = createSurfaceTuning();
    const grade = new Float32Array(n);
    const reach = CART_HULL.radius + OBSTACLE_PAD_M;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = col + row * this.cols;
        const x = this.minX + (col + 0.5) * NAV_CELL_M;
        const z = this.minZ + (row + 0.5) * NAV_CELL_M;
        if (!cellInZone(source.zone, x, z)) continue;
        if (insideObstacle(source.obstacles, x, z, reach)) continue;
        const surface = source.surfaces.surfaceAt(x, z);
        if (surface === SurfaceId.Water) continue;
        const h = source.heightAt(x, z);
        let steepest = 0;
        let wet = false;
        for (let k = 0; k < 4; k++) {
          const sx = x + STEP_DX[k]! * SAMPLE_OUT_M;
          const sz = z + STEP_DZ[k]! * SAMPLE_OUT_M;
          if (source.surfaces.surfaceAt(sx, sz) === SurfaceId.Water) wet = true;
          steepest = Math.max(steepest, Math.abs(source.heightAt(sx, sz) - h) / SAMPLE_OUT_M);
        }
        if (wet) continue;
        source.surfaces.tuningAt(x, z, tuning);
        const limit = Math.tan(NAV_CLIMB_MARGIN * maxClimbRad(tire, tuning.cartSpeedScale, CART_TUNING.accel));
        if (steepest > limit) continue;
        this.passable[i] = 1;
        grade[i] = steepest;
        this.cost[i] = tireResistance(tire, resistanceFromSpeedScale(tuning.cartSpeedScale)) + GRADE_COST * steepest * steepest;
      }
    }
    let minCost = Infinity;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = col + row * this.cols;
        if (this.passable[i] === 0) continue;
        if (this.besideRefused(col, row)) this.cost[i] = this.cost[i]! + NEAR_REFUSED_COST;
        minCost = Math.min(minCost, this.cost[i]!);
      }
    }
    this.minCost = minCost === Infinity ? 1 : minCost;
  }

  /** The cell holding a point, or -1 off the grid. */
  cellAt(x: number, z: number): number {
    const col = Math.floor((x - this.minX) / NAV_CELL_M);
    const row = Math.floor((z - this.minZ) / NAV_CELL_M);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return col + row * this.cols;
  }

  /** True where a cart may drive. */
  passableAt(x: number, z: number): boolean {
    const i = this.cellAt(x, z);
    return i >= 0 && this.passable[i] === 1;
  }

  centreX(cell: number): number {
    return this.minX + ((cell % this.cols) + 0.5) * NAV_CELL_M;
  }

  centreZ(cell: number): number {
    return this.minZ + (Math.floor(cell / this.cols) + 0.5) * NAV_CELL_M;
  }

  /** Whether a straight drive from a to b stays on passable cells, walked at `LINE_STEP_M` steps. */
  lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / LINE_STEP_M));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.passableAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /**
   * Plans from one point to another into `out`: waypoints after the start, the goal last. False,
   * with `out.count` 0, when either end has no passable cell within `SNAP_RINGS` or the search runs
   * past `NAV_MAX_EXPANSIONS`. Allocation-free.
   */
  plan(fromX: number, fromZ: number, toX: number, toZ: number, out: NavRoute): boolean {
    out.count = 0;
    const start = this.snap(fromX, fromZ);
    const goal = this.snap(toX, toZ);
    if (start < 0 || goal < 0) return false;
    if (!this.search(start, goal)) return false;

    // The cells, start to goal.
    let length = 0;
    for (let c = goal; c !== -1; c = this.parent[c]!) this.chain[length++] = c;
    for (let a = 0, b = length - 1; a < b; a++, b--) {
      const t = this.chain[a]!;
      this.chain[a] = this.chain[b]!;
      this.chain[b] = t;
    }

    // Pulled tight: from each kept point, on to the farthest cell a straight line reaches.
    const goalExact = this.passable[this.cellAt(toX, toZ)] === 1 && this.cellAt(toX, toZ) === goal;
    let atX = fromX;
    let atZ = fromZ;
    let k = 0;
    while (k < length - 1 && out.count < NAV_ROUTE_CAPACITY - 1) {
      let next = k + 1;
      while (next + 1 < length && this.lineClear(atX, atZ, this.centreX(this.chain[next + 1]!), this.centreZ(this.chain[next + 1]!))) next++;
      if (next === length - 1) break;
      atX = this.centreX(this.chain[next]!);
      atZ = this.centreZ(this.chain[next]!);
      out.points[out.count * 2] = atX;
      out.points[out.count * 2 + 1] = atZ;
      out.count++;
      k = next;
    }
    out.points[out.count * 2] = goalExact ? toX : this.centreX(goal);
    out.points[out.count * 2 + 1] = goalExact ? toZ : this.centreZ(goal);
    out.count++;
    return true;
  }

  /** The nearest passable cell within `SNAP_RINGS`, nearest by distance and then by index; -1 if none. */
  private snap(x: number, z: number): number {
    const here = this.cellAt(x, z);
    if (here >= 0 && this.passable[here] === 1) return here;
    const col = Math.floor((x - this.minX) / NAV_CELL_M);
    const row = Math.floor((z - this.minZ) / NAV_CELL_M);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= SNAP_RINGS && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = col + dx;
          const w = row + dz;
          if (c < 0 || w < 0 || c >= this.cols || w >= this.rows) continue;
          const i = c + w * this.cols;
          if (this.passable[i] === 0) continue;
          const d = Math.hypot(this.centreX(i) - x, this.centreZ(i) - z);
          if (d < bestD || (d === bestD && i < best)) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  private search(start: number, goal: number): boolean {
    this.generation++;
    if (this.generation === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
    const gen = this.generation;
    const cols = this.cols;
    const goalCol = goal % cols;
    const goalRow = Math.floor(goal / cols);
    this.heapSize = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = gen;
    this.push(start, this.heuristic(start, goalCol, goalRow));
    let expansions = 0;
    while (this.heapSize > 0) {
      const cell = this.pop();
      if (this.closed[cell] === gen) continue;
      if (cell === goal) return true;
      this.closed[cell] = gen;
      if (++expansions > NAV_MAX_EXPANSIONS) return false;
      const col = cell % cols;
      const row = (cell - col) / cols;
      for (let k = 0; k < 8; k++) {
        const c = col + STEP_DX[k]!;
        const r = row + STEP_DZ[k]!;
        if (c < 0 || r < 0 || c >= cols || r >= this.rows) continue;
        const next = c + r * cols;
        if (this.passable[next] === 0 || this.closed[next] === gen) continue;
        // No cutting a refused cell's corner.
        if (k >= 4 && (this.passable[c + row * cols] === 0 || this.passable[col + r * cols] === 0)) continue;
        const g = this.g[cell]! + (k >= 4 ? SQRT2 : 1) * NAV_CELL_M * this.cost[next]!;
        if (this.seen[next] === gen && g >= this.g[next]!) continue;
        this.seen[next] = gen;
        this.g[next] = g;
        this.parent[next] = cell;
        if (this.heapSize >= this.heapCell.length) return false;
        this.push(next, g + this.heuristic(next, goalCol, goalRow));
      }
    }
    return false;
  }

  private heuristic(cell: number, goalCol: number, goalRow: number): number {
    const col = cell % this.cols;
    const dx = Math.abs(col - goalCol);
    const dz = Math.abs((cell - col) / this.cols - goalRow);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * NAV_CELL_M * this.minCost;
  }

  /** Ordered by key, then by cell index, so equal keys pop the same way everywhere. */
  private before(a: number, b: number): boolean {
    const ka = this.heapKey[a]!;
    const kb = this.heapKey[b]!;
    return ka < kb || (ka === kb && this.heapCell[a]! < this.heapCell[b]!);
  }

  private swap(a: number, b: number): void {
    const c = this.heapCell[a]!;
    const k = this.heapKey[a]!;
    this.heapCell[a] = this.heapCell[b]!;
    this.heapKey[a] = this.heapKey[b]!;
    this.heapCell[b] = c;
    this.heapKey[b] = k;
  }

  private push(cell: number, key: number): void {
    let i = this.heapSize++;
    this.heapCell[i] = cell;
    this.heapKey[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private pop(): number {
    const top = this.heapCell[0]!;
    const last = --this.heapSize;
    if (last > 0) {
      this.heapCell[0] = this.heapCell[last]!;
      this.heapKey[0] = this.heapKey[last]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= last) break;
        const r = l + 1;
        const child = r < last && this.before(r, l) ? r : l;
        if (!this.before(child, i)) break;
        this.swap(child, i);
        i = child;
      }
    }
    return top;
  }

  private besideRefused(col: number, row: number): boolean {
    for (let k = 0; k < 8; k++) {
      const c = col + STEP_DX[k]!;
      const r = row + STEP_DZ[k]!;
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true;
      if (this.passable[c + r * this.cols] === 0) return true;
    }
    return false;
  }
}

/** A cell's corners and edge midpoints, pushed `ZONE_MARGIN_M` out, all inside the zone. */
function cellInZone(zone: NavSource["zone"], x: number, z: number): boolean {
  const r = NAV_CELL_M / 2 + ZONE_MARGIN_M;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!zone.contains(x + dx * r, z + dz * r)) return false;
    }
  }
  return true;
}

function boundsOf(polygon: readonly { readonly x: number; readonly z: number }[]): Bounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Inside a building's footprint grown by `reach` (`lineOfSight.ts`'s rotated-box convention). */
function insideObstacle(obstacles: readonly Obstacle[], x: number, z: number, reach: number): boolean {
  for (const o of obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const lx = dx * o.cos - dz * o.sin;
    const lz = dx * o.sin + dz * o.cos;
    if (Math.abs(lx) <= o.halfX + reach && Math.abs(lz) <= o.halfZ + reach) return true;
  }
  return false;
}

const built = new WeakMap<object, WeakMap<object, NavGraph>>();

/** One graph per ground and zone, so a rematch on the same ground does not rebuild it (§2.4). */
export function navGraphFor(source: NavSource): NavGraph {
  let byZone = built.get(source.surfaces);
  if (byZone === undefined) {
    byZone = new WeakMap();
    built.set(source.surfaces, byZone);
  }
  let graph = byZone.get(source.zone);
  if (graph === undefined) {
    graph = new NavGraph(source);
    byZone.set(source.zone, graph);
  }
  return graph;
}
