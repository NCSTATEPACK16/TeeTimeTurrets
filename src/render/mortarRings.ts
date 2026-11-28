import * as THREE from "three";
import { MAX_BARRAGES, MORTAR_BALLS, MORTAR_BALL_GAP_S, MORTAR_SPREAD_M, MORTAR_TELEGRAPH_S } from "../sim/mortar";

/**
 * The Mulligan Mortar's telegraph on the ground (UI-SPEC H20, Stage 3.5c): a red ring the size of
 * the barrage's spread, with a disc that fills it over the two seconds before the first ball, then
 * stays lit while the rest come down. Everyone sees it, because the point of a telegraph is that
 * the target can drive out of it. Render-only; `MatchScreen` shows one per `mortarCalled` event.
 *
 * One mesh pair per barrage slot the sim has, made once and reused.
 */

const RING_COLOUR = 0xff3b2a;
const LIFT_M = 0.15;
const RING_WIDTH_M = 0.45;
const SEGMENTS = 64;
/** From the call to the last ball, and a beat after it. */
const SHOWN_S = MORTAR_TELEGRAPH_S + (MORTAR_BALLS - 1) * MORTAR_BALL_GAP_S + 0.4;

export interface MortarRings {
  readonly objects: readonly THREE.Object3D[];
  /** A barrage called at `elapsedSeconds`, centred on x, y, z. */
  show(x: number, y: number, z: number, elapsedSeconds: number): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createMortarRings(): MortarRings {
  const ringGeometry = new THREE.RingGeometry(MORTAR_SPREAD_M - RING_WIDTH_M, MORTAR_SPREAD_M, SEGMENTS);
  ringGeometry.rotateX(-Math.PI / 2);
  const discGeometry = new THREE.CircleGeometry(1, SEGMENTS);
  discGeometry.rotateX(-Math.PI / 2);

  const objects: THREE.Object3D[] = [];
  const groups: THREE.Group[] = [];
  const discs: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const startedAt = new Float64Array(MAX_BARRAGES).fill(-Infinity);

  const material = (opacity: number): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({
      color: RING_COLOUR,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    materials.push(m);
    return m;
  };

  for (let i = 0; i < MAX_BARRAGES; i++) {
    const group = new THREE.Group();
    group.name = `mortar_ring_${i}`;
    group.visible = false;
    group.add(new THREE.Mesh(ringGeometry, material(0.9)));
    const disc = new THREE.Mesh(discGeometry, material(0.28));
    group.add(disc);
    groups.push(group);
    discs.push(disc);
    objects.push(group);
  }

  let next = 0;
  return {
    objects,
    show(x, y, z, elapsedSeconds) {
      const i = next;
      next = (next + 1) % MAX_BARRAGES;
      startedAt[i] = elapsedSeconds;
      groups[i]!.position.set(x, y + LIFT_M, z);
      groups[i]!.visible = true;
    },
    update(elapsedSeconds) {
      for (let i = 0; i < MAX_BARRAGES; i++) {
        const group = groups[i]!;
        if (!group.visible) continue;
        const t = elapsedSeconds - startedAt[i]!;
        if (t > SHOWN_S || t < 0) {
          group.visible = false;
          continue;
        }
        // The disc fills the ring by the first ball, then holds.
        const fill = Math.min(1, t / MORTAR_TELEGRAPH_S) * MORTAR_SPREAD_M;
        discs[i]!.scale.setScalar(Math.max(0.01, fill));
      }
    },
    dispose() {
      ringGeometry.dispose();
      discGeometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
