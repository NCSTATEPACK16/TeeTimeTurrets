import { describe, expect, it } from "vitest";
import { courseArenaZone } from "../sim/arena";
import { authoredCourse } from "../sim/authoredCourse";
import { AUTHORED_CLUBHOUSE } from "../sim/authoredLayout";
import { buildCourseWorld } from "../sim/courseWorld";
import { FAR_TREE_OUTSIDE_M, createCourseTrees, outsideBy } from "./Trees";
import * as THREE from "three";

/**
 * The far woods (Stage 5 spec, §4.1): trees well outside the arena zone are the low-poly species,
 * in meshes of their own, and every tree is still planted exactly once.
 */
describe("woods LOD", () => {
  it("draws trees 60 m outside the zone low-poly, and only those", () => {
    const world = buildCourseWorld(authoredCourse(2026), 2026);
    const zone = courseArenaZone(world).polygon;
    const options = { seed: 2026, southBoundary: world.southBoundary, clubhouse: AUTHORED_CLUBHOUSE };
    const whole = createCourseTrees(world.terrain, world.surfaces, options);
    const split = createCourseTrees(world.terrain, world.surfaces, { ...options, zone });
    try {
      const at = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const tally = (meshes: readonly THREE.InstancedMesh[]) => meshes.reduce((n, m) => n + m.count, 0);
      const far = split.meshes.filter((m) => m.name === "far-trees");
      const near = split.meshes.filter((m) => m.name !== "far-trees");

      // Nothing lost or doubled by the split, and the split is real: most of the course is far.
      expect(tally(split.meshes)).toBe(tally(whole.meshes));
      expect(tally(far)).toBeGreaterThan(tally(whole.meshes) / 3);
      expect(tally(near)).toBeGreaterThan(100);

      const outside = (mesh: THREE.InstancedMesh, i: number): number => {
        mesh.getMatrixAt(i, at);
        p.setFromMatrixPosition(at);
        return outsideBy(zone, p.x, p.z);
      };
      for (const mesh of far) for (let i = 0; i < mesh.count; i++) expect(outside(mesh, i)).toBeGreaterThan(FAR_TREE_OUTSIDE_M);
      for (const mesh of near) for (let i = 0; i < mesh.count; i++) expect(outside(mesh, i)).toBeLessThanOrEqual(FAR_TREE_OUTSIDE_M);

      // The stand-in is the cheap one: the course's woods cost well under what they did whole.
      const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      const drawn = (meshes: readonly THREE.InstancedMesh[]) => meshes.reduce((n, m) => n + m.count * triangles(m.geometry), 0);
      const saving = drawn(split.meshes) / drawn(whole.meshes);
      console.log(`[woodsLod] near ${tally(near)}, far ${tally(far)} trees; ${split.meshes.length} meshes; ` +
        `${(drawn(whole.meshes) / 1e6).toFixed(2)}M -> ${(drawn(split.meshes) / 1e6).toFixed(2)}M triangles; ` +
        `per species ${split.meshes.map((m) => `${m.name || "near"}:${triangles(m.geometry)}`).join(" ")}`);
      expect(saving).toBeLessThan(0.75);
    } finally {
      whole.dispose();
      split.dispose();
    }
  }, 15_000);
});
