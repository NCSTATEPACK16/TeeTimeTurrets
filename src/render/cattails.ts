import * as THREE from "three";
import { courseKitGraph } from "../entities/envGraphs";
import { mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import type { PlacedCattail } from "./cattailPlacement";
import { TREE_WIND_TIME } from "./Trees";

/**
 * The cattail fringe, drawn: every clump is one copy of the course kit's `pond_reeds`
 * (`course_kit.json`, authored at ground contact), all merged into a single draw.
 *
 * They sway on the trees' wind clock, bending from each clump's root (`aAboveBase`, written by
 * the merge). No collider. Decorative only.
 */
/**
 * Reeds are drawn this much wider than authored. The kit's reed is 7 cm across, true to life and
 * under a pixel from 20 m; the toy style wants a chunky blade that reads.
 */
const REED_WIDTH = 2.4;

/**
 * Sway in metres per metre-squared of height above the root: a 1.8 m cattail's head moves about
 * 8 cm. The bend grows with height squared, so the base stays planted.
 */
const CATTAIL_SWAY = 0.025;

export interface Cattails {
  /** Null when no clump was placed. */
  readonly mesh: THREE.Mesh | null;
  readonly count: number;
  dispose(): void;
}

export function createCattails(placed: readonly PlacedCattail[], heightAt: (x: number, z: number) => number): Cattails {
  if (placed.length === 0) return { mesh: null, count: 0, dispose() {} };
  const up = new THREE.Vector3(0, 1, 0);
  const matrices = placed.map((p) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z),
      new THREE.Quaternion().setFromAxisAngle(up, p.yaw),
      new THREE.Vector3(p.scale * REED_WIDTH, p.scale, p.scale * REED_WIDTH),
    ),
  );
  // No contact shade: the clumps are scaled, so graph space is not metres above the ground.
  const merged: MergedGraph = mergeGraphInstances(courseKitGraph("pond_reeds"), matrices, {}, {
    contactShade: false,
    baseHeight: true,
  });
  merged.mesh.name = "cattails";
  const material = merged.mesh.material as THREE.MeshStandardMaterial;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = TREE_WIND_TIME;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n uniform float uTreeTime;\n attribute float aAboveBase;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           // The merged mesh is in world space, so the position is where the reed stands.
           float bend = max(aAboveBase, 0.0);
           bend *= bend;
           float phase = uTreeTime * 1.4 + dot(position.xz, vec2(0.071, 0.053));
           transformed.x += (sin(phase) + 0.35 * sin(phase * 2.3 + 1.7)) * ${CATTAIL_SWAY.toFixed(4)} * bend;
           transformed.z += cos(phase * 0.8) * ${(CATTAIL_SWAY * 0.6).toFixed(4)} * bend;
         }`,
      );
  };
  material.customProgramCacheKey = () => "ttt-cattails";
  return { mesh: merged.mesh, count: placed.length, dispose: () => merged.dispose() };
}
