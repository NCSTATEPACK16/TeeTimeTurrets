import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSurfaceWeights } from "../sim/surfaces";
import { miniCourse } from "../sim/testing/miniCourse";
import { QUALITY } from "./quality";
import { GRASS_CELL_M, GRASS_REACH_M, GrassCarpet, grassAllowed } from "./grassCarpet";

describe("GrassCarpet", () => {
  const { terrain, surfaces } = miniCourse(6, 8, 2026);
  const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);
  const tee = terrain.holes[0]!;
  const start = { x: tee.placement.offsetX, z: tee.placement.offsetZ };

  it("covers the ring of cells round the camera out to its reach", () => {
    const grass = new GrassCarpet(surfaces, heightAt, QUALITY.high);
    grass.update(start.x, start.z, 0);
    const side = (2 * GRASS_REACH_M) / GRASS_CELL_M;
    expect(grass.cellCount).toBe(side * side);
    grass.dispose();
  });

  it("rebuilds only the cells that came into reach when the camera crosses a cell", () => {
    const grass = new GrassCarpet(surfaces, heightAt, QUALITY.high);
    grass.update(start.x, start.z, 0);
    const before = grass.rebuilds;
    grass.update(start.x + 1, start.z, 0.1);
    expect(grass.rebuilds).toBe(before);
    grass.update(start.x + GRASS_CELL_M, start.z, 0.2);
    expect(grass.rebuilds - before).toBe((2 * GRASS_REACH_M) / GRASS_CELL_M);
    grass.dispose();
  });

  it("grows only where grass is allowed: never on greens, sand or water", () => {
    const grass = new GrassCarpet(surfaces, heightAt, QUALITY.high);
    grass.update(start.x, start.z, 0);
    const mesh = grass.mesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const w = createSurfaceWeights();
    let live = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (m.elements[0] === 0) continue; // an empty slot, scaled to nothing
      live++;
      surfaces.weightsAt(p.x, p.z, w);
      expect(grassAllowed(w)).toBe(true);
      expect(w.green).toBeGreaterThan(0.99);
      expect(w.sand).toBe(0);
      expect(w.water).toBe(0);
    }
    expect(live).toBeGreaterThan(100);
    grass.dispose();
  });

  it("grows less at Low than at High", () => {
    const low = new GrassCarpet(surfaces, heightAt, QUALITY.low);
    const high = new GrassCarpet(surfaces, heightAt, QUALITY.high);
    low.update(start.x, start.z, 0);
    high.update(start.x, start.z, 0);
    expect(low.bladeClumps).toBeLessThan(high.bladeClumps * 0.5);
    low.dispose();
    high.dispose();
  });
});
