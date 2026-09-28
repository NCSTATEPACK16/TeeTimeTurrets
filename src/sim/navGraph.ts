import { zoneEdgePoints, zoneSignedDistance } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import { pathWeightAt } from "./cartPaths";
import type { CartPath } from "./cartPaths";
import { TireType } from "./entities/Cart";
import { maxClimbRad, resistanceOf } from "./mobility";
import { SurfaceId, createSurfaceTuning } from "./surfaces";
import type { Surfaces } from "./surfaces";

/**
 * Where a bot can drive, and the way there: an 8 m grid over the arena zone, searched with A*.
 *
 * Adapted from `src/vendor/cot/botRoutePlanner.ts` (NOTICE): its binary min-heap A* over a height
 * grid, its no-corner-cutting rule and its nearest-open-cell fallback. What changed:
 *
 * - The grid covers the zone only, at a cell size passed in, instead of a fixed +/-500 m world at
 *   25 m. Every cell outside the zone is closed, so no route can leave it.
 * - A cell is closed when it is water or on a pond's bank. A step between cells is closed when it climbs steeper than
 *   `mobility.maxClimbRad` allows on the ground it climbs onto -- the same limit the character
 *   controller holds a cart to, so the planner never sends a bot up a face it cannot drive.
 * - A step costs its length times the ground's resistance, and less on a cart path, so a route
 *   prefers fairway to rough and a path to both.
 * - The route is pulled taut: from each waypoint the next is the furthest cell in a straight clear
 *   line, not every third cell.
 *
 * Built once per course; planning allocates nothing, reusing the graph's own search arrays.
 */

export const NAV_CELL_M = 8;
/** The most the build may take on the course, ms. The tests hold it to this. */
export const NAV_BUILD_BUDGET_MS = 150;
/** A path cell's cost relative to the same ground without one. */
const PATH_COST = 0.7;
const SQRT2 = Math.SQRT2;
const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export interface NavGraph {
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** 1 where a cart may be. */
  readonly passable: Uint8Array;
  readonly heights: Float32Array;
  /** Cost per metre of entering the cell. */
  readonly cost: Float32Array;
  /** Steepest pitch a cart can climb onto the cell, radians. */
  readonly climb: Float32Array;
  /** Search scratch, reused by every plan. */
  readonly g: Float64Array;
  readonly parent: Int32Array;
  readonly stamp: Uint32Array;
  readonly closed: Uint32Array;
  readonly heapIndex: Int32Array;
  readonly heapScore: Float64Array;
  readonly raw: Int32Array;
  search: number;
}

export function buildNavGraph(
  zone: ArenaZone,
  heightAt: (x: number, z: number) => number,
  surfaces: Surfaces,
  paths: readonly CartPath[],
  cell = NAV_CELL_M,
): NavGraph {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of zoneEdgePoints(zone, cell * 4)) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxZ - minZ) / cell) + 1;
  const n = cols * rows;
  const passable = new Uint8Array(n);
  const heights = new Float32Array(n);
  const cost = new Float32Array(n);
  const climb = new Float32Array(n);
  const tuning = createSurfaceTuning();
  const wet = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = minX + c * cell;
      const z = minZ + r * cell;
      if (zoneSignedDistance(zone, x, z) > 0) continue;
      if (surfaces.surfaceAt(x, z) === SurfaceId.Water) {
        wet[i] = 1;
        continue;
      }
      surfaces.tuningAt(x, z, tuning);
      passable[i] = 1;
      heights[i] = heightAt(x, z);
      const onPath = paths.length > 0 && pathWeightAt(paths, x, z) > 0.5;
      cost[i] = resistanceOf(tuning, TireType.Street) * (onPath ? PATH_COST : 1);
      climb[i] = maxClimbRad(tuning, TireType.Street);
    }
  }
  // A cell's width of bank round every pond is closed too: a cart steering for a waypoint on the
  // water's edge swings wide of the line between cells, and its capsule has a radius.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!wet[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) passable[rr * cols + cc] = 0;
        }
      }
    }
  }
  return {
    minX,
    minZ,
    cell,
    cols,
    rows,
    passable,
    heights,
    cost,
    climb,
    g: new Float64Array(n),
    parent: new Int32Array(n),
    stamp: new Uint32Array(n),
    closed: new Uint32Array(n),
    heapIndex: new Int32Array(n * 4),
    heapScore: new Float64Array(n * 4),
    raw: new Int32Array(n),
    search: 0,
  };
}

/** The cell (x, z) falls in, clamped to the grid. */
export function cellIndexAt(graph: NavGraph, x: number, z: number): number {
  const c = Math.min(graph.cols - 1, Math.max(0, Math.round((x - graph.minX) / graph.cell)));
  const r = Math.min(graph.rows - 1, Math.max(0, Math.round((z - graph.minZ) / graph.cell)));
  return r * graph.cols + c;
}

/** Whether every cell on the straight line from a to b is open. */
export function lineClear(graph: NavGraph, ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / (graph.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!graph.passable[cellIndexAt(graph, ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
  }
  return true;
}

/**
 * Plans from (ax, az) to (bx, bz) and writes the waypoints into `out` as x, z pairs, the last being
 * the goal itself. Returns how many, or 0 when there is no way there.
 */
export function planRoute(graph: NavGraph, ax: number, az: number, bx: number, bz: number, out: Float32Array): number {
  const start = nearestOpen(graph, cellIndexAt(graph, ax, az));
  const goal = nearestOpen(graph, cellIndexAt(graph, bx, bz));
  if (start < 0 || goal < 0) return 0;

  const { cols, rows, passable, heights, cost, climb, g, parent, stamp, closed, heapIndex, heapScore, cell } = graph;
  const search = ++graph.search;
  const gx = goal % cols;
  const gz = Math.floor(goal / cols);
  let heapSize = 0;
  const push = (index: number, score: number): void => {
    if (heapSize >= heapIndex.length) return;
    let i = heapSize++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heapScore[up]! <= score) break;
      heapIndex[i] = heapIndex[up]!;
      heapScore[i] = heapScore[up]!;
      i = up;
    }
    heapIndex[i] = index;
    heapScore[i] = score;
  };
  const pop = (): number => {
    const top = heapIndex[0]!;
    heapSize--;
    if (heapSize > 0) {
      const lastIndex = heapIndex[heapSize]!;
      const lastScore = heapScore[heapSize]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= heapSize) break;
        const r = l + 1;
        const child = r < heapSize && heapScore[r]! < heapScore[l]! ? r : l;
        if (heapScore[child]! >= lastScore) break;
        heapIndex[i] = heapIndex[child]!;
        heapScore[i] = heapScore[child]!;
        i = child;
      }
      heapIndex[i] = lastIndex;
      heapScore[i] = lastScore;
    }
    return top;
  };

  stamp[start] = search;
  g[start] = 0;
  parent[start] = -1;
  push(start, 0);
  let found = false;
  while (heapSize > 0) {
    const node = pop();
    if (closed[node] === search) continue;
    closed[node] = search;
    if (node === goal) {
      found = true;
      break;
    }
    const nx0 = node % cols;
    const nz0 = Math.floor(node / cols);
    for (const [dx, dz, scale] of STEPS) {
      const nx = nx0 + dx;
      const nz = nz0 + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const next = nz * cols + nx;
      if (!passable[next] || closed[next] === search) continue;
      // No cutting a corner past a closed cell.
      if (dx !== 0 && dz !== 0 && (!passable[nz0 * cols + nx] || !passable[nz * cols + nx0])) continue;
      const distance = cell * scale;
      const rise = heights[next]! - heights[node]!;
      if (rise > 0 && Math.atan(rise / distance) > climb[next]!) continue;
      const tentative = g[node]! + distance * cost[next]!;
      if (stamp[next] === search && tentative >= g[next]!) continue;
      stamp[next] = search;
      g[next] = tentative;
      parent[next] = node;
      push(next, tentative + Math.hypot(gx - nx, gz - nz) * cell);
    }
  }
  if (!found) return 0;

  // Walk back to the start, then pull the route taut.
  const raw = graph.raw;
  let length = 0;
  for (let at = goal; at >= 0 && length < raw.length; at = at === start ? -1 : parent[at]!) raw[length++] = at;
  let count = 0;
  let fromX = ax;
  let fromZ = az;
  let i = length - 1;
  while (i > 0 && count * 2 + 2 <= out.length) {
    // The furthest cell toward the goal still in a clear straight line from here.
    let j = 0;
    while (j < i && !lineClear(graph, fromX, fromZ, cellX(graph, raw[j]!), cellZ(graph, raw[j]!))) j++;
    if (j === 0) break;
    fromX = cellX(graph, raw[j]!);
    fromZ = cellZ(graph, raw[j]!);
    out[count * 2] = fromX;
    out[count * 2 + 1] = fromZ;
    count++;
    i = j;
  }
  if (count * 2 + 2 <= out.length) {
    out[count * 2] = bx;
    out[count * 2 + 1] = bz;
    count++;
  }
  return count;
}

function cellX(graph: NavGraph, index: number): number {
  return graph.minX + (index % graph.cols) * graph.cell;
}

function cellZ(graph: NavGraph, index: number): number {
  return graph.minZ + Math.floor(index / graph.cols) * graph.cell;
}

/** The open cell nearest `index`, searching rings out to six cells; -1 if there is none. */
function nearestOpen(graph: NavGraph, index: number): number {
  if (graph.passable[index]) return index;
  const c0 = index % graph.cols;
  const r0 = Math.floor(index / graph.cols);
  for (let radius = 1; radius <= 6; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= graph.cols || r >= graph.rows) continue;
        if (graph.passable[r * graph.cols + c]) return r * graph.cols + c;
      }
    }
  }
  return -1;
}

/** A bot's current route: waypoints as x, z pairs, the one it is heading for, and when to replan. */
export interface NavRoute {
  readonly points: Float32Array;
  count: number;
  next: number;
  replanIn: number;
}

/** Waypoints a route may hold. A taut route across the zone needs a handful. */
export const NAV_MAX_WAYPOINTS = 48;

export function createNavRoute(): NavRoute {
  return { points: new Float32Array(NAV_MAX_WAYPOINTS * 2), count: 0, next: 0, replanIn: 0 };
}

const graphs = new WeakMap<object, NavGraph>();

/** The graph for `key` (a course's playfield), built once and shared by every match on it. */
export function navGraphFor(key: object, build: () => NavGraph): NavGraph {
  let graph = graphs.get(key);
  if (!graph) {
    graph = build();
    graphs.set(key, graph);
  }
  return graph;
}
