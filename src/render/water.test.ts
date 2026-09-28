import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { polygonSignedDistance } from "../sim/hazards";
import { toHoleFrame } from "../sim/courseLayout";
import { miniCourse } from "../sim/testing/miniCourse";
import { QUALITY } from "./quality";
import { createWater } from "./water";

describe("createWater", () => {
  const { terrain } = miniCourse(6, 8, 2026);
  const wet = terrain.holes.filter((h) => h.spec.water.length > 0);

  it("covers every pond on the course, in one draw, at its hole's water level", () => {
    expect(wet.length).toBeGreaterThan(0);
    const water = createWater(terrain, QUALITY.medium);
    expect(water.group.children.length).toBe(1);
    const mesh = water.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    const levels = new Set(wet.map((h) => h.spec.waterLevel));
    for (let i = 0; i < pos.count; i += 7) {
      const y = pos.getY(i);
      expect([...levels].some((l) => Math.abs(y - l) < 0.2)).toBe(true);
    }
    water.dispose();
  });

  it("fades out at the shore: opaque inside a pond, clear a step outside it", () => {
    const water = createWater(terrain, QUALITY.medium);
    const mesh = water.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    const shore = mesh.geometry.getAttribute("aShore");
    const local = { x: 0, z: 0 };
    let inside = 0;
    let outside = 0;
    for (let i = 0; i < pos.count; i++) {
      let best = Infinity;
      for (const hole of wet) {
        toHoleFrame(hole.placement, pos.getX(i), pos.getZ(i), local);
        for (const poly of hole.spec.water) best = Math.min(best, polygonSignedDistance(local.x, local.z, poly));
      }
      if (best < -3) {
        expect(shore.getX(i)).toBeGreaterThan(0.9);
        inside++;
      }
      if (best > 1.5) {
        expect(shore.getX(i)).toBeLessThan(0.05);
        outside++;
      }
    }
    expect(inside).toBeGreaterThan(10);
    expect(outside).toBeGreaterThan(0);
    water.dispose();
  });

  it("animates ripples only above Low", () => {
    const low = createWater(terrain, QUALITY.low);
    const med = createWater(terrain, QUALITY.medium);
    low.update(1);
    med.update(1);
    expect(low.animated).toBe(false);
    expect(med.animated).toBe(true);
    low.dispose();
    med.dispose();
  });
});
