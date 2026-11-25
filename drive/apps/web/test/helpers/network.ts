/**
 * The cart-path network as a graph, for the continuous course drive. Nodes are paths.json points;
 * edges join neighbors on a path (a jump of more than GAP_M is the pipeline's junction gap, so the
 * path breaks there) and join each piece end to the nearest point of every other path within
 * JOIN_M (a branch's first point sits past the trunk's flattened corridor).
 */
import type { HolesJson, PathsJson } from '@gcs/level-schema';

export const JOIN_M = 5;
const GAP_M = 3;
/** Hole paths run 31 m off the centerline; a green or tee counts as visited within this. */
export const REACH_M = 35;

export interface NetPoint {
  x: number;
  z: number;
  path: string;
}

export class PathNetwork {
  readonly points: NetPoint[] = [];
  private readonly adj: [number, number][][] = [];

  constructor(paths: PathsJson['paths']) {
    const ends: number[] = [];
    const link = (a: number, b: number, w: number) => {
      this.adj[a]!.push([b, w]);
      this.adj[b]!.push([a, w]);
    };
    for (const p of paths) {
      const base = this.points.length;
      for (const q of p.points) {
        this.points.push({ x: q[0], z: q[2], path: p.id });
        this.adj.push([]);
      }
      ends.push(base, base + p.points.length - 1);
      for (let i = base + 1; i < this.points.length; i++) {
        const d = this.dist(i - 1, i);
        if (d < GAP_M) link(i - 1, i, d);
        else ends.push(i - 1, i);
      }
    }
    for (const e of ends) {
      const best = new Map<string, [number, number]>();
      const pe = this.points[e]!;
      this.points.forEach((q, j) => {
        if (q.path === pe.path) return;
        const d = Math.hypot(q.x - pe.x, q.z - pe.z);
        const was = best.get(q.path);
        if (d <= JOIN_M && (!was || d < was[1])) best.set(q.path, [j, d]);
      });
      for (const [j, d] of best.values()) link(e, j, d);
    }
  }

  dist(a: number, b: number): number {
    const p = this.points[a]!;
    const q = this.points[b]!;
    return Math.hypot(p.x - q.x, p.z - q.z);
  }

  nearest(x: number, z: number): [number, number] {
    let bi = 0;
    let bd = Infinity;
    this.points.forEach((q, i) => {
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bd) [bi, bd] = [i, d];
    });
    return [bi, bd];
  }

  /** Shortest walk from `start` to the first node inside `zone` (Dijkstra with a binary heap). */
  walk(start: number, zone: (i: number) => boolean): number[] {
    const n = this.points.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap: [number, number][] = [[0, start]];
    cost[start] = 0;
    const push = (item: [number, number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up]![0] <= heap[i]![0]) break;
        [heap[up], heap[i]] = [heap[i]!, heap[up]!];
        i = up;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, u] = pop();
      if (c > cost[u]!) continue;
      if (zone(u)) {
        const out: number[] = [];
        for (let v = u; v >= 0; v = prev[v]!) out.push(v);
        return out.reverse();
      }
      for (const [v, w] of this.adj[u]!) {
        if (c + w < cost[v]!) {
          cost[v] = c + w;
          prev[v] = u;
          push([c + w, v]);
        }
      }
    }
    return [];
  }

  /** Points within reach of (x, z): REACH_M, or a little past the network's closest approach. */
  zone(x: number, z: number): (i: number) => boolean {
    const r = Math.max(REACH_M, this.nearest(x, z)[1] + 5);
    return (i) => Math.hypot(this.points[i]!.x - x, this.points[i]!.z - z) <= r;
  }

  /** Tee 1 to green 18 on the network, by way of every green in order. Empty if a leg has no way. */
  round(holes: HolesJson['holes']): number[] {
    const sorted = [...holes].sort((a, b) => a.number - b.number);
    const route = [this.nearest(sorted[0]!.tee.x, sorted[0]!.tee.z)[0]];
    for (const h of sorted) {
      const leg = this.walk(route[route.length - 1]!, this.zone(h.green.x, h.green.z));
      if (!leg.length) return [];
      route.push(...leg.slice(1));
    }
    return route;
  }
}

/** Where the route turns harder than a cart can on a 2.4 m path: more than 100° within ±4 points. */
export function reversals(net: PathNetwork, route: number[]): number[] {
  const out: number[] = [];
  for (let i = 4; i < route.length - 4; i++) {
    const a = net.points[route[i - 4]!]!;
    const b = net.points[route[i]!]!;
    const c = net.points[route[i + 4]!]!;
    let d = Math.abs(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z));
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > (100 * Math.PI) / 180 && (!out.length || i - out[out.length - 1]! > 8)) out.push(i);
  }
  return out;
}
