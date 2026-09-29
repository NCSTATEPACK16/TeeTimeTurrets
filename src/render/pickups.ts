import * as THREE from "three";
import { mergeGraph, type MergedGraph } from "../entities/primitiveGraph";
import { PICKUP_COLOURS, pickupGraph } from "../entities/kitGraphs";
import { PICKUP_TYPES, type PickupSite, type PickupType } from "../sim/pickupSites";

/**
 * Pickup presentation (`docs/art/specs/pickups.md`): one instanced mesh per item type and one for
 * every glow pillar, so four draws for all sites. Items spin and bob inside their pillar.
 *
 * `setReady(i, false)` hides a site's item and dims nothing else yet. The pillar stays, per the
 * Stage D rule that the cylinder outlives the item; the dimmed "recharging" state and the take
 * burst come with collection in issue #76.
 */

const PILLAR_RADIUS_M = 1.5;
const PILLAR_HEIGHT_M = 2.6;
const ITEM_HEIGHT_M = 1.3;
const SPIN_RAD_PER_S = 1.2;
const BOB_M = 0.08;
const BOB_HZ = 0.8;
/** The hot dog is authored standing up; it floats lying most of the way down. */
const HOT_DOG_TILT = THREE.MathUtils.degToRad(70);

export interface PickupView {
  readonly objects: readonly THREE.Object3D[];
  setReady(site: number, ready: boolean): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createPickupView(
  sites: readonly PickupSite[],
  heightAt: (x: number, z: number) => number,
): PickupView {
  const ground = sites.map((s) => heightAt(s.x, s.z));
  const ready = sites.map(() => true);

  // Items: per type, the sites of that type and their slot in the instanced mesh.
  const merged: MergedGraph[] = [];
  const items: { type: PickupType; mesh: THREE.InstancedMesh; sites: number[] }[] = [];
  for (const type of PICKUP_TYPES) {
    const ofType = sites.flatMap((s, i) => (s.type === type ? [i] : []));
    if (ofType.length === 0) continue;
    const source = mergeGraph(pickupGraph(type), PICKUP_COLOURS[type]);
    merged.push(source);
    const mesh = new THREE.InstancedMesh(source.mesh.geometry, source.mesh.material, ofType.length);
    mesh.name = `pickup-${type}`;
    mesh.frustumCulled = false;
    items.push({ type, mesh, sites: ofType });
  }

  // Pillars: open cylinders, fading out upward, additive gold.
  const pillarGeometry = new THREE.CylinderGeometry(PILLAR_RADIUS_M, PILLAR_RADIUS_M, PILLAR_HEIGHT_M, 12, 1, true);
  pillarGeometry.translate(0, PILLAR_HEIGHT_M / 2, 0);
  const fade = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const a = Math.round(255 * (1 - i / 15));
    fade.set([a, a, a, 255], i * 4);
  }
  const fadeTexture = new THREE.DataTexture(fade, 1, 16);
  fadeTexture.needsUpdate = true;
  const pillarMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc24a,
    transparent: true,
    opacity: 0.45,
    alphaMap: fadeTexture,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, Math.max(1, sites.length));
  pillars.name = "pickup-pillars";
  pillars.count = sites.length;
  pillars.frustumCulled = false;
  const m = new THREE.Matrix4();
  sites.forEach((s, i) => pillars.setMatrixAt(i, m.makeTranslation(s.x, ground[i]!, s.z)));
  pillars.instanceMatrix.needsUpdate = true;

  // Frame scratch: `update` runs every frame, so it allocates nothing.
  const position = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), HOT_DOG_TILT);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  const hidden = new THREE.Vector3(0, 0, 0);

  const update = (t: number): void => {
    for (let j = 0; j < items.length; j++) {
      const { type, mesh, sites: ofType } = items[j]!;
      for (let k = 0; k < ofType.length; k++) {
        const i = ofType[k]!;
        const s = sites[i]!;
        const phase = i * 1.7;
        position.set(s.x, ground[i]! + ITEM_HEIGHT_M + BOB_M * Math.sin(2 * Math.PI * BOB_HZ * t + phase), s.z);
        spin.setFromAxisAngle(yAxis, SPIN_RAD_PER_S * t + phase);
        if (type === "hot_dog") spin.multiply(tilt);
        m.compose(position, spin, ready[i] ? unit : hidden);
        mesh.setMatrixAt(k, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);

  return {
    objects: [pillars, ...items.map((v) => v.mesh)],
    setReady(site, isReady) {
      ready[site] = isReady;
    },
    update,
    dispose() {
      for (const source of merged) source.dispose();
      for (const { mesh } of items) mesh.dispose();
      pillars.dispose();
      pillarGeometry.dispose();
      pillarMaterial.dispose();
      fadeTexture.dispose();
    },
  };
}
