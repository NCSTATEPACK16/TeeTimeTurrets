import { beforeAll, describe, expect, it } from "vitest";
import { arenaFromCourse, courseArenaZone } from "./arena";
import { BOT_STANDOFF } from "./bot";
import type { Cart } from "./entities/Cart";
import { CART_COLLIDER } from "./entities/Cart";
import { neutralIntent } from "./intent";
import { Sim } from "./world";
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
/** One course for the whole file: baking its grids is most of the file's time. */
const world: CourseWorld = buildCourseWorld(authoredCourse(2026), 2026);

describe("nav graph", () => {
  let zone: ArenaZone;
  let source: NavSource;
  let graph: NavGraph;
  beforeAll(() => {
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

/**
 * Stage 6, slice 2 (spec §5): a bot routes round the zone's widest pond to reach a target on the far
 * bank, through the real `Sim` and Rapier, and never gets wet. The control is the same match with
 * the graph taken away: the straight-line bot of before.
 */

const TPS = 60;

interface RigLike {
  cart: Cart;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}


/**
 * The widest run of water inside the zone, north-south or east-west, by the ground's own classes,
 * with 10 m of bank at each end. On the shipped course that is hole 10's pond, about 125 m long; the
 * hole-18 pond the plan named is only about 11 m across inside the zone.
 */
function crossing(sim: Sim): { ax: number; az: number; bx: number; bz: number } {
  const zone = arenaFromCourse(world).zone!;
  const wet = (x: number, z: number) => sim.surfaces.surfaceAt(x, z) === SurfaceId.Water;
  const xs = zone.polygon.map((p) => p.x);
  const zs = zone.polygon.map((p) => p.z);
  let best = { ax: 0, az: 0, bx: 0, bz: 0, width: 0 };
  for (const [ux, uz] of [[1, 0], [0, 1]] as const) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 2) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) {
        if (!zone.contains(x, z) || !wet(x, z) || wet(x - ux, z - uz)) continue;
        let b = 0;
        while (wet(x + ux * (b + 1), z + uz * (b + 1))) b++;
        const ax = x - ux * 10;
        const az = z - uz * 10;
        const bx = x + ux * (b + 10);
        const bz = z + uz * (b + 10);
        if (!zone.contains(ax, az) || !zone.contains(bx, bz) || wet(ax, az) || wet(bx, bz)) continue;
        if (b + 20 > best.width) best = { ax, az, bx, bz, width: b + 20 };
      }
    }
  }
  return best;
}

async function run(routing: boolean): Promise<{ closest: number; wetTicks: number; width: number }> {
  // No capture flags: a lone bot is its side's flag runner and would drive to them instead.
  const sim = await Sim.create({ ...arenaFromCourse(world), captureSites: [] }, { botCount: 1 });
  try {
    if (!routing) (sim as unknown as { nav: null }).nav = null;
    const { ax, az, bx, bz } = crossing(sim);
    const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
    const place = (cart: Cart, x: number, z: number, heading: number) => {
      const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
      cart.position.x = x;
      cart.position.y = y;
      cart.position.z = z;
      cart.heading = heading;
      rigs.find((r) => r.cart === cart)!.body.setTranslation({ x, y, z }, true);
    };
    const toward = Math.atan2(bz - az, bx - ax);
    place(sim.cart, bx, bz, toward + Math.PI);
    place(sim.bots[0]!, ax, az, toward);

    let closest = Infinity;
    let wetTicks = 0;
    const bot = sim.bots[0]!;
    for (let tick = 0; tick < 30 * TPS; tick++) {
      // The target stays put: kept alive so a kill does not send it back to its pad.
      sim.cart.health.hp = sim.cart.health.max;
      sim.step(neutralIntent());
      if (sim.surfaces.surfaceAt(bot.position.x, bot.position.z) === SurfaceId.Water) wetTicks++;
      closest = Math.min(closest, Math.hypot(bot.position.x - bx, bot.position.z - bz));
      // Settled either way: there, or in the water.
      if (wetTicks > 0 || closest < BOT_STANDOFF + 6) break;
    }
    return { closest, wetTicks, width: Math.hypot(bx - ax, bz - az) };
  } finally {
    sim.dispose();
  }
}

describe("bot routing", () => {
  it("takes a bot round the zone's widest pond to a target on the far bank, dry", async () => {
    const routed = await run(true);
    const straight = await run(false);
    console.log(`[botRouting] width ${routed.width.toFixed(0)} m; routed closest ${routed.closest.toFixed(1)} m, wet ${routed.wetTicks}; straight closest ${straight.closest.toFixed(1)} m, wet ${straight.wetTicks}`);
    // A premise: a pond worth going round.
    expect(routed.width).toBeGreaterThan(80);
    expect(routed.wetTicks).toBe(0);
    expect(routed.closest).toBeLessThan(BOT_STANDOFF + 6);
    // The control: without the graph the bot drives into the water first.
    expect(straight.wetTicks).toBeGreaterThan(0);
    expect(straight.closest).toBeGreaterThan(BOT_STANDOFF + 6);
  }, 60_000);
});
