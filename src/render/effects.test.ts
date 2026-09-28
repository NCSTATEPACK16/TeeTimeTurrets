import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ClubType } from "../physics/Ballistics";
import { Effects, PUFF_CAPACITY } from "./effects";

describe("Effects", () => {
  it("puts a muzzle puff up and lets it die", () => {
    const fx = new Effects();
    fx.muzzle(0, 2, 0, ClubType.Putter);
    expect(fx.activePuffs).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.activePuffs).toBe(0);
  });

  it("makes a bigger cloud for a driver than a putter, and a bigger one again for a death", () => {
    const putter = new Effects();
    putter.muzzle(0, 0, 0, ClubType.Putter);
    const driver = new Effects();
    driver.muzzle(0, 0, 0, ClubType.Driver);
    const burst = new Effects();
    burst.burst(0, 0, 0);
    expect(driver.activePuffs).toBeGreaterThan(putter.activePuffs);
    expect(burst.activePuffs).toBeGreaterThan(driver.activePuffs);
  });

  it("recycles the oldest puff rather than growing past its capacity", () => {
    const fx = new Effects();
    for (let i = 0; i < PUFF_CAPACITY; i++) fx.burst(0, 0, 0);
    expect(fx.activePuffs).toBe(PUFF_CAPACITY);
    fx.update(1 / 60);
    const mesh = fx.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    expect(mesh.count).toBe(PUFF_CAPACITY);
  });

  it("draws only the live puffs", () => {
    const fx = new Effects();
    fx.impact(0, 0, 0);
    fx.update(1 / 60);
    const mesh = fx.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    expect(mesh.count).toBe(fx.activePuffs);
    expect(mesh.count).toBeGreaterThan(0);
  });

  it("spreads a splash ring out and fades it, then hides it", () => {
    const fx = new Effects();
    fx.splash(3, 0, 4);
    fx.update(0.1);
    const ring = fx.children.find((c) => c.visible && (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh;
    expect(ring).toBeDefined();
    expect(ring.position.x).toBe(3);
    const early = ring.scale.x;
    const earlyOpacity = (ring.material as THREE.MeshBasicMaterial).opacity;
    fx.update(0.3);
    expect(ring.scale.x).toBeGreaterThan(early);
    expect((ring.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(earlyOpacity);
    fx.update(2);
    expect(ring.visible).toBe(false);
  });

  it("frees every geometry and material it made", () => {
    const fx = new Effects();
    const disposals: string[] = [];
    fx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      vi.spyOn(mesh.geometry, "dispose").mockImplementation(() => disposals.push("geometry"));
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) vi.spyOn(m, "dispose").mockImplementation(() => disposals.push("material"));
    });
    const meshes = fx.children.filter((c) => (c as THREE.Mesh).isMesh).length;
    fx.dispose();
    expect(disposals.filter((d) => d === "material")).toHaveLength(meshes);
    expect(disposals.filter((d) => d === "geometry").length).toBeGreaterThanOrEqual(2);
  });
});
