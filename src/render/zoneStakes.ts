import * as THREE from "three";
import { zoneEdgePoints } from "../sim/arenaZone";
import type { ArenaZone } from "../sim/arenaZone";

/**
 * The arena zone's edge as a golf course marks out of bounds: white stakes every
 * `STAKE_SPACING_M`, and a rope strung through their tops. One instanced draw for the stakes and
 * one line for the rope, whatever the zone's size.
 */

export const STAKE_SPACING_M = 15;
const STAKE_HEIGHT_M = 1.1;
const STAKE_WIDTH_M = 0.09;
/** Where the rope runs, below the stake tops. */
const ROPE_HEIGHT_M = 0.85;

export class ZoneStakes extends THREE.Group {
  readonly stakes: THREE.InstancedMesh;
  readonly rope: THREE.LineLoop;

  constructor(zone: ArenaZone, heightAt: (x: number, z: number) => number) {
    super();
    this.name = "zone-stakes";
    const points = zoneEdgePoints(zone, STAKE_SPACING_M);

    const geometry = new THREE.BoxGeometry(STAKE_WIDTH_M, STAKE_HEIGHT_M, STAKE_WIDTH_M);
    const material = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.6 });
    this.stakes = new THREE.InstancedMesh(geometry, material, points.length);
    this.stakes.castShadow = true;
    const m = new THREE.Matrix4();
    const rope = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const ground = heightAt(p.x, p.z);
      m.makeTranslation(p.x, ground + STAKE_HEIGHT_M / 2, p.z);
      this.stakes.setMatrixAt(i, m);
      rope[i * 3] = p.x;
      rope[i * 3 + 1] = ground + ROPE_HEIGHT_M;
      rope[i * 3 + 2] = p.z;
    }
    this.stakes.instanceMatrix.needsUpdate = true;
    this.stakes.computeBoundingSphere();

    const ropeGeometry = new THREE.BufferGeometry();
    ropeGeometry.setAttribute("position", new THREE.BufferAttribute(rope, 3));
    this.rope = new THREE.LineLoop(ropeGeometry, new THREE.LineBasicMaterial({ color: 0xe8e2d0 }));
    this.add(this.stakes, this.rope);
  }

  dispose(): void {
    this.stakes.geometry.dispose();
    (this.stakes.material as THREE.Material).dispose();
    this.stakes.dispose();
    this.rope.geometry.dispose();
    (this.rope.material as THREE.Material).dispose();
  }
}
