import { describe, expect, it } from "vitest";
import { AUTHORED_CLUBHOUSE } from "./authoredLayout";
import { createArenaZone, zoneSignedDistance } from "./arenaZone";
import { createCartPaths } from "./cartPaths";
import { toCourseFrame } from "./courseGeometry";
import { SurfaceId } from "./surfaces";
import { miniCourse } from "./testing/miniCourse";
import { NAV_BUILD_BUDGET_MS, buildNavGraph, cellIndexAt, lineClear, planRoute } from "./navGraph";
import type { NavGraph } from "./navGraph";

const course = miniCourse(18, 8, 2026);
const zone = createArenaZone(course.holes, AUTHORED_CLUBHOUSE);
const paths = createCartPaths(course.holes, AUTHORED_CLUBHOUSE);
// The ground the game plans on: the playfield's baked heights and surfaces.
const playfield = course.ground.playfield;
const heightAt = (x: number, z: number): number => playfield.heightAt(x, z);
let graph: NavGraph;
let buildMs = 0;
{
  // The first build also bakes the playfield's grids, which in a match `Sim.create` has already
  // done; the second is the one a match pays for.
  buildNavGraph(zone, heightAt, playfield.surfaces, paths);
  const t0 = performance.now();
  graph = buildNavGraph(zone, heightAt, playfield.surfaces, paths);
  buildMs = performance.now() - t0;
}

/** Water as the sim has it: a causeway over a pond is dry, drivable ground. */
function inWater(x: number, z: number): boolean {
  return playfield.surfaces.surfaceAt(x, z) === SurfaceId.Water;
}

function routeOf(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const out = new Float32Array(512);
  const n = planRoute(graph, from.x, from.z, to.x, to.z, out);
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: out[i * 2]!, z: out[i * 2 + 1]! });
  return pts;
}

describe("navGraph", () => {
  it("builds inside its budget", () => {
    expect(buildMs).toBeLessThan(NAV_BUILD_BUDGET_MS);
  });

  it("is connected across the zone: the clubhouse reaches almost every open cell", () => {
    const start = cellIndexAt(graph, AUTHORED_CLUBHOUSE.x, AUTHORED_CLUBHOUSE.z);
    expect(graph.passable[start]).toBe(1);
    const seen = new Uint8Array(graph.passable.length);
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop()!;
      const cx = i % graph.cols;
      const cz = Math.floor(i / graph.cols);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= graph.cols || nz >= graph.rows) continue;
        const j = nz * graph.cols + nx;
        if (seen[j] || !graph.passable[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    let open = 0;
    let reached = 0;
    for (let i = 0; i < graph.passable.length; i++) {
      if (!graph.passable[i]) continue;
      open++;
      if (seen[i]) reached++;
    }
    expect(open).toBeGreaterThan(3000);
    expect(reached / open).toBeGreaterThan(0.95);
  });

  it("routes a bot round hole 18's pond rather than through it", () => {
    const hole = course.holes.find((h) => h.spec.index === 17)!;
    const pond = hole.spec.water[0]!.points;
    let cx = 0;
    let cz = 0;
    for (const p of pond) {
      cx += p.x / pond.length;
      cz += p.z / pond.length;
    }
    let reach = 0;
    for (const p of pond) reach = Math.max(reach, Math.hypot(p.x - cx, p.z - cz));
    // Across the pond, square to the hole: along it runs the causeway, which is dry.
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    toCourseFrame(hole.placement, cx, cz - reach - 15, a);
    toCourseFrame(hole.placement, cx, cz + reach + 15, b);
    // The straight line crosses the pond; the route must not.
    let crosses = false;
    for (let t = 0; t <= 1; t += 0.01) if (inWater(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) crosses = true;
    expect(crosses).toBe(true);
    expect(lineClear(graph, a.x, a.z, b.x, b.z)).toBe(false);

    const route = routeOf(a, b);
    expect(route.length).toBeGreaterThan(1);
    let prev = a;
    for (const p of route) {
      for (let t = 0; t <= 1; t += 0.05) {
        expect(inWater(prev.x + (p.x - prev.x) * t, prev.z + (p.z - prev.z) * t)).toBe(false);
      }
      prev = p;
    }
    const last = route[route.length - 1]!;
    expect(Math.hypot(last.x - b.x, last.z - b.z)).toBeLessThan(1e-3);
  });

  it("never routes out of the zone", () => {
    const tees = course.holes
      .filter((h) => [0, 8, 9, 13, 14, 17].includes(h.spec.index))
      .map((h) => {
        const out = { x: 0, z: 0 };
        toCourseFrame(h.placement, h.spec.tee.x, h.spec.tee.z, out);
        return out;
      });
    for (const from of tees) {
      for (const to of tees) {
        if (from === to) continue;
        for (const p of routeOf(from, to)) expect(zoneSignedDistance(zone, p.x, p.z)).toBeLessThan(1);
      }
    }
  });
});
