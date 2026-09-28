import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createZoneFromPoints, zoneEdgePoints } from "../sim/arenaZone";
import { STAKE_SPACING_M, ZoneStakes } from "./zoneStakes";

const zone = createZoneFromPoints(
  [
    { x: 0, z: 0 },
    { x: 200, z: 0 },
    { x: 200, z: 120 },
    { x: 0, z: 120 },
  ],
  20,
);
const heightAt = (x: number, z: number): number => 0.01 * x + 0.02 * z;

describe("ZoneStakes", () => {
  it("stands one stake on the ground at every edge point, in one draw", () => {
    const stakes = new ZoneStakes(zone, heightAt);
    const points = zoneEdgePoints(zone, STAKE_SPACING_M);
    expect(stakes.stakes.count).toBe(points.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
      stakes.stakes.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(points[i]!.x, 3);
      expect(p.z).toBeCloseTo(points[i]!.z, 3);
      expect(p.y).toBeGreaterThanOrEqual(heightAt(p.x, p.z));
      expect(p.y).toBeLessThan(heightAt(p.x, p.z) + 1.5);
    }
    stakes.dispose();
  });

  it("strings a closed rope through the stake tops", () => {
    const stakes = new ZoneStakes(zone, heightAt);
    const rope = stakes.rope.geometry.getAttribute("position");
    expect(rope.count).toBeGreaterThanOrEqual(stakes.stakes.count);
    expect(stakes.rope).toBeInstanceOf(THREE.LineLoop);
    stakes.dispose();
  });
});
