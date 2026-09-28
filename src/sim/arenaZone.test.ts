import { describe, expect, it } from "vitest";
import { authoredCourse } from "./authoredCourse";
import { AUTHORED_CLUBHOUSE, AUTHORED_PLACEMENTS } from "./authoredLayout";
import { toCourseFrame } from "./courseGeometry";
import { createTeamPads } from "./spawn";
import {
  ARENA_HOLE_INDICES,
  OOB_DRAIN_INTERVAL_S,
  ZONE_CLAMP_REACH_M,
  clampToZone,
  createArenaZone,
  createZoneFromPoints,
  outOfBoundsDrain,
  zoneEdgePoints,
  zoneSignedDistance,
} from "./arenaZone";
import type { ZoneHole } from "./arenaZone";

const specs = authoredCourse(2026).holes;
const holes: ZoneHole[] = AUTHORED_PLACEMENTS.map((placement) => ({ placement, spec: specs[placement.index]! }));
const zone = createArenaZone(holes, AUTHORED_CLUBHOUSE);

function course(hole: ZoneHole, p: { x: number; z: number }): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, p.x, p.z, out);
  return out;
}

describe("the arena zone", () => {
  it("is holes 1, 9, 10, 14, 15 and 18", () => {
    expect([...ARENA_HOLE_INDICES]).toEqual([0, 8, 9, 13, 14, 17]);
  });

  it("holds every tee, cup and corridor point of the six holes, and the clubhouse and its pads", () => {
    for (const index of ARENA_HOLE_INDICES) {
      const hole = holes.find((h) => h.spec.index === index)!;
      for (const p of [hole.spec.tee, hole.spec.cup, ...hole.spec.control]) {
        const c = course(hole, p);
        expect(zoneSignedDistance(zone, c.x, c.z)).toBeLessThan(-10);
      }
    }
    expect(zoneSignedDistance(zone, AUTHORED_CLUBHOUSE.x, AUTHORED_CLUBHOUSE.z)).toBeLessThan(-10);
    for (const pad of createTeamPads(AUTHORED_CLUBHOUSE, () => 0)) {
      for (const slot of pad) expect(zoneSignedDistance(zone, slot.x, slot.z)).toBeLessThan(-10);
    }
  });

  it("leaves the far holes outside", () => {
    const outside = holes.filter((h) => !(ARENA_HOLE_INDICES as readonly number[]).includes(h.spec.index));
    const cupsOut = outside.filter((h) => {
      const c = course(h, h.spec.cup);
      return zoneSignedDistance(zone, c.x, c.z) > 0;
    });
    expect(cupsOut.length).toBeGreaterThanOrEqual(6);
  });

  it("is about 600 by 350 m, not the whole course", () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of zoneEdgePoints(zone, 15)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const long = Math.max(maxX - minX, maxZ - minZ);
    const short = Math.min(maxX - minX, maxZ - minZ);
    expect(long).toBeLessThan(900);
    expect(short).toBeLessThan(700);
  });

  it("measures signed distance: negative inside, zero on the edge, positive outside", () => {
    const square = createZoneFromPoints(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
        { x: 0, z: 100 },
      ],
      10,
    );
    expect(zoneSignedDistance(square, 50, 50)).toBeCloseTo(-60, 6);
    expect(zoneSignedDistance(square, 110, 50)).toBeCloseTo(0, 6);
    expect(zoneSignedDistance(square, 130, 50)).toBeCloseTo(20, 6);
    // Past a corner the padded edge is round.
    expect(zoneSignedDistance(square, 130, 140)).toBeCloseTo(40, 6);
  });

  it("clamps a point to the reach past the edge, and leaves one inside it alone", () => {
    const square = createZoneFromPoints(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
        { x: 0, z: 100 },
      ],
      10,
    );
    const out = { x: 0, z: 0 };
    expect(clampToZone(square, 120, 50, ZONE_CLAMP_REACH_M, out)).toBe(false);
    expect(out).toEqual({ x: 120, z: 50 });
    expect(clampToZone(square, 300, 50, ZONE_CLAMP_REACH_M, out)).toBe(true);
    expect(out.x).toBeCloseTo(100 + 10 + ZONE_CLAMP_REACH_M, 6);
    expect(out.z).toBeCloseTo(50, 6);
    expect(clampToZone(square, -500, -500, 0, out)).toBe(true);
    expect(zoneSignedDistance(square, out.x, out.z)).toBeCloseTo(0, 6);
  });

  it("puts stakes along the whole edge at the spacing asked for", () => {
    const points = zoneEdgePoints(zone, 15);
    expect(points.length).toBeGreaterThan(80);
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      expect(zoneSignedDistance(zone, a.x, a.z)).toBeCloseTo(0, 3);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(15 * 1.2);
    }
  });

  it("drains a point every two seconds outside, and nothing before the first two", () => {
    expect(outOfBoundsDrain(0, 1.99)).toBe(0);
    expect(outOfBoundsDrain(1.99, 2.0)).toBe(1);
    expect(outOfBoundsDrain(2.0, 3.9)).toBe(0);
    expect(outOfBoundsDrain(3.99, 4.01)).toBe(1);
    expect(OOB_DRAIN_INTERVAL_S).toBe(2);
  });
});
