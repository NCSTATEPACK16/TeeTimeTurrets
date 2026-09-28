import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PATH_HALF_WIDTH_M, pathWeightAt } from "../sim/cartPaths";
import type { CartPath } from "../sim/cartPaths";
import { createCartPathRibbons } from "./cartPathRibbons";

const paths: CartPath[] = [
  { kind: "clubhouse", points: [{ x: 0, z: 0 }, { x: 100, z: 40 }] },
  { kind: "green-to-tee", points: [{ x: 200, z: 0 }, { x: 230, z: -30 }] },
];
const heightAt = (x: number, z: number): number => 0.05 * x - 0.02 * z;

describe("createCartPathRibbons", () => {
  it("draws every path in one mesh, on the path and just above the ground", () => {
    const ribbons = createCartPathRibbons(paths, heightAt);
    const pos = ribbons.mesh.geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(8);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(pathWeightAt(paths, x, z)).toBeGreaterThan(0.99);
      expect(pos.getY(i)).toBeGreaterThan(heightAt(x, z));
      expect(pos.getY(i)).toBeLessThan(heightAt(x, z) + 0.2);
    }
    expect(ribbons.mesh).toBeInstanceOf(THREE.Mesh);
    ribbons.dispose();
  });

  it("is as wide as the path the sim drives on", () => {
    const ribbons = createCartPathRibbons([paths[0]!], heightAt);
    const pos = ribbons.mesh.geometry.getAttribute("position");
    const ax = pos.getX(0) - pos.getX(1);
    const az = pos.getZ(0) - pos.getZ(1);
    expect(Math.hypot(ax, az)).toBeCloseTo(2 * PATH_HALF_WIDTH_M, 3);
    ribbons.dispose();
  });
});
