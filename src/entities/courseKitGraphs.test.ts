import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./primitiveGraph";
import { COURSE_KIT_NAMES, courseKitGraph, type CourseKitName } from "./envGraphs";

/** Stage 5a smoke check for `course_kit.json` (`docs/art/specs/stage5/course-kit.md`). */

const BUDGET = 150;

function measure(name: CourseKitName, part?: string): { box: THREE.Box3; triangles: number } {
  const built = buildGraph(courseKitGraph(name));
  built.root.updateMatrixWorld(true);
  const target = part ? built.root.getObjectByName(part) : built.root;
  if (!target) throw new Error(`${name} has no part ${part}`);
  const box = part ? new THREE.Box3().setFromObject(target, true) : new THREE.Box3().setFromObject(built.root);
  let triangles = 0;
  built.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    triangles += (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3;
  });
  built.dispose();
  return { box, triangles };
}

describe("the course kit", () => {
  it.each(COURSE_KIT_NAMES)("%s builds within %i triangles", (name) => {
    expect(measure(name).triangles).toBeLessThanOrEqual(BUDGET);
  });

  it("stands the zone stake 1.0 m tall with its rope eye at 0.8 m", () => {
    expect(Math.abs(measure("zone_stake").box.max.y - 1.0)).toBeLessThanOrEqual(0.05);
    const eye = measure("zone_stake", "ck_stake_eye").box.getCenter(new THREE.Vector3());
    expect(Math.abs(eye.y - 0.8)).toBeLessThanOrEqual(0.05);
  });

  it.each(["tee_riser", "path_kerb"] as const)("tiles %s at exactly 2.0 m along z", (name) => {
    const { box } = measure(name);
    expect(Math.abs(box.max.z - box.min.z - 2.0)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(box.max.z + box.min.z)).toBeLessThanOrEqual(0.01);
  });
});
