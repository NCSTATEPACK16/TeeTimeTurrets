import * as THREE from "three";
import { courseKitGraph } from "../entities/envGraphs";
import { mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import type { PlacedCattail } from "./cattailPlacement";

/**
 * The cattail fringe, drawn: every clump is one copy of the course kit's `pond_reeds`
 * (`course_kit.json`, authored at ground contact), all merged into a single draw.
 *
 * No collider and no sway: the merged graph brings its own plain material. Decorative only.
 */
/**
 * Reeds are drawn this much wider than authored. The kit's reed is 7 cm across, true to life and
 * under a pixel from 20 m; the toy style wants a chunky blade that reads.
 */
const REED_WIDTH = 2.4;

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
  const merged: MergedGraph = mergeGraphInstances(courseKitGraph("pond_reeds"), matrices, {}, { contactShade: false });
  merged.mesh.name = "cattails";
  return { mesh: merged.mesh, count: placed.length, dispose: () => merged.dispose() };
}
