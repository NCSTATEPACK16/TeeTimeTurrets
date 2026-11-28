import { beforeAll, describe, expect, it } from "vitest";
import { courseArenaZone } from "./arena";
import type { ArenaZone } from "./arenaZone";
import { authoredCourse } from "./authoredCourse";
import { AUTHORED_CLUBHOUSE } from "./authoredLayout";
import { pathHoles } from "./cartPaths";
import { clubhouseObstacles } from "./clubhouse";
import { buildCourseWorld } from "./courseWorld";
import type { CourseWorld } from "./courseWorld";
import { NAV_CELL_M, NavGraph, createNavRoute } from "./navGraph";
import type { NavSource } from "./navGraph";
import { mulberry32 } from "./rng";
import { SurfaceId } from "./surfaceId";

/** The bots' graph on the shipped course (Stage 6 spec, §5). One course, one graph. */
describe("nav graph", () => {
  let world: CourseWorld;
  let zone: ArenaZone;
  let source: NavSource;
  let graph: NavGraph;
  beforeAll(() => {
    world = buildCourseWorld(authoredCourse(2026), 2026);
    zone = courseArenaZone(world);
    const grids = world.grids;
    source = {
      heightAt: grids.heightAt,
      surfaces: grids.surfaces,
      zone,
      obstacles: clubhouseObstacles(AUTHORED_CLUBHOUSE, grids.heightAt),
    };
    graph = new NavGraph(source);
  }, 30_000);

  it("is connected across the zone", () => {
    let passable = 0;
    for (const p of graph.passable) passable += p;
    expect(passable).toBeGreaterThan(5000);
    // Flood from the passable cell nearest the clubhouse.
    let start = -1;
    let nearest = Infinity;
    for (let i = 0; i < graph.passable.length; i++) {
      if (graph.passable[i] === 0) continue;
      const d = Math.hypot(graph.centreX(i) - AUTHORED_CLUBHOUSE.x, graph.centreZ(i) - AUTHORED_CLUBHOUSE.z);
      if (d < nearest) {
        nearest = d;
        start = i;
      }
    }
    const reached = new Uint8Array(graph.passable.length);
    const queue = [start];
    reached[start] = 1;
    let count = 0;
    while (queue.length > 0) {
      const cell = queue.pop()!;
      count++;
      const col = cell % graph.cols;
      const row = (cell - col) / graph.cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= graph.cols || r >= graph.rows) continue;
        const next = c + r * graph.cols;
        if (graph.passable[next] === 0 || reached[next] === 1) continue;
        reached[next] = 1;
        queue.push(next);
      }
    }
    expect(count / passable).toBeGreaterThan(0.97);
  });

  it("routes around the hole-18 pond", () => {
    // A straight line across the pond: the widest east-west run of water near hole 18.
    const hole = pathHoles(world.holes)[17]!;
    const cx = (hole.tee.x + hole.green.x) / 2;
    const cz = (hole.tee.z + hole.green.z) / 2;
    const reach = Math.hypot(hole.green.x - hole.tee.x, hole.green.z - hole.tee.z) / 2 + 40;
    let best: { ax: number; bx: number; z: number; wet: number } | null = null;
    for (let z = cz - reach; z <= cz + reach; z += 2) {
      for (let x = cx - reach; x <= cx + reach; x += 2) {
        if (!zone.contains(x, z) || source.surfaces.surfaceAt(x, z) !== SurfaceId.Water) continue;
        // Out of the water by the ground's own classes, not the graph's, so the premise does not
        // depend on what is under test; then on to the first cell a cart could start from.
        const wet = (px: number) => source.surfaces.surfaceAt(px, z) === SurfaceId.Water;
        let ax = x;
        while (wet(ax) && ax > x - 120) ax -= 1;
        while (!graph.passableAt(ax, z) && ax > x - 120) ax -= 1;
        let bx = x;
        while (wet(bx) && bx < x + 120) bx += 1;
        while (!graph.passableAt(bx, z) && bx < x + 120) bx += 1;
        if (!graph.passableAt(ax, z) || !graph.passableAt(bx, z)) continue;
        if (best === null || bx - ax > best.bx - best.ax) best = { ax: ax - NAV_CELL_M, bx: bx + NAV_CELL_M, z, wet: x };
      }
    }
    expect(best, "a pond near hole 18 inside the zone").not.toBeNull();
    const { ax, bx, z } = best!;
    expect(bx - ax).toBeGreaterThan(15);
    expect(graph.lineClear(ax, z, bx, z)).toBe(false);

    const route = createNavRoute();
    expect(graph.plan(ax, z, bx, z, route)).toBe(true);
    let length = 0;
    let px = ax;
    let pz = z;
    for (let k = 0; k < route.count; k++) {
      const qx = route.points[k * 2]!;
      const qz = route.points[k * 2 + 1]!;
      const leg = Math.hypot(qx - px, qz - pz);
      for (let s = 0; s <= leg; s += 0.5) {
        const x = px + ((qx - px) * s) / Math.max(leg, 1e-9);
        const y = pz + ((qz - pz) * s) / Math.max(leg, 1e-9);
        if (source.surfaces.surfaceAt(x, y) === SurfaceId.Water) expect.fail(`leg ${k} wet at (${x.toFixed(1)}, ${y.toFixed(1)})`);
      }
      length += leg;
      px = qx;
      pz = qz;
    }
    expect(length).toBeGreaterThan(bx - ax);
  });

  it("never leaves the zone", () => {
    const random = mulberry32(6);
    const xs = zone.polygon.map((p) => p.x);
    const zs = zone.polygon.map((p) => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const inside = (): [number, number] => {
      for (;;) {
        const x = minX + random() * (maxX - minX);
        const z = minZ + random() * (maxZ - minZ);
        if (zone.contains(x, z)) return [x, z];
      }
    };
    const route = createNavRoute();
    let planned = 0;
    for (let n = 0; n < 200; n++) {
      const [ax, az] = inside();
      const [bx, bz] = inside();
      if (!graph.plan(ax, az, bx, bz, route)) continue;
      planned++;
      let px = ax;
      let pz = az;
      for (let k = 0; k < route.count; k++) {
        const qx = route.points[k * 2]!;
        const qz = route.points[k * 2 + 1]!;
        const leg = Math.hypot(qx - px, qz - pz);
        // The first leg starts wherever the bot is; every later one must stay in.
        if (k > 0) {
          for (let s = 0; s <= leg; s += 1) {
            const x = px + ((qx - px) * s) / Math.max(leg, 1e-9);
            const y = pz + ((qz - pz) * s) / Math.max(leg, 1e-9);
            if (!zone.contains(x, y)) expect.fail(`pair ${n}, leg ${k} out at (${x.toFixed(1)}, ${y.toFixed(1)})`);
          }
        }
        px = qx;
        pz = qz;
      }
    }
    expect(planned).toBeGreaterThan(180);
  });

  it("builds in 150 ms or less", () => {
    new NavGraph(source);
    const t0 = performance.now();
    new NavGraph(source);
    const ms = performance.now() - t0;
    console.log(`[navGraph] built in ${ms.toFixed(0)} ms, ${graph.cols} x ${graph.rows} cells`);
    expect(ms).toBeLessThan(150);
  });
});
