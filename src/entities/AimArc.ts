import * as THREE from "three";
import { PREVIEW_MAX_POINTS } from "../sim/tickConstants";
import type { Vec3 } from "../sim/world";

/**
 * The aim arc (UI-SPEC H10): where the shot the player would fire now goes, from the muzzle to
 * the ground. The points come from `Sim.previewTrajectory`, which mirrors the ball's own flight,
 * so the arc and the shot cannot disagree. For the putter it is close to a laser sight.
 *
 * One fixed buffer sized to `PREVIEW_MAX_POINTS`, rewritten in place each frame and trimmed with
 * the draw range, so nothing is allocated per frame. Render-only.
 */
export class AimArc extends THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  private readonly positions: Float32Array;
  private readonly attribute: THREE.BufferAttribute;

  constructor() {
    const positions = new Float32Array(PREVIEW_MAX_POINTS * 3);
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", attribute);
    super(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.positions = positions;
    this.attribute = attribute;
    // The arc moves every frame and spans the course; precomputed bounds would cull it wrongly.
    this.frustumCulled = false;
    this.geometry.setDrawRange(0, 0);
    this.visible = false;
  }

  /** The first `count` of `points`, as `previewTrajectory` wrote them. */
  setPoints(points: readonly Vec3[], count: number): void {
    const n = Math.min(count, PREVIEW_MAX_POINTS, points.length);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    }
    this.attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    // One point is the muzzle alone: nothing to draw a line along.
    this.visible = n >= 2;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
