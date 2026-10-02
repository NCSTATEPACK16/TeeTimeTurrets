import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import { HILL_NAMES, hillGraph, type HillName } from "../entities/envGraphs";
import type { Bounds } from "../sim/courseLayout";
import { mulberry32 } from "../sim/rng";
import { BIOMES } from "./biomes";
import { PARKLAND_SKY } from "./sky";

/**
 * A ring of distant hill cards past the course bounds (`docs/art/specs/stage5/horizon-hills.md`),
 * so the fog meets a skyline rather than a flat plane. Decorative only: one draw, no shadows, never
 * read by the sim.
 */

/** How far past the bounds' half-diagonal the ring stands. */
export const RING_OFFSET_M = 180;
/** At least this many cards, whatever the radius. */
export const MIN_CARDS = 16;
const YAW_JITTER = THREE.MathUtils.degToRad(8);
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.3;
/** The base sits this far below the lowest ground on the bounds, so no card floats. */
const SINK_M = 5;
/** How finely the bounds' edge is sampled for its lowest ground. */
const EDGE_STEP_M = 10;
/**
 * The haze: each card's colour is the parkland foliage this far toward the sky's horizon, which is
 * also the fog's colour (`render/sky.ts`), so the ring reads as distant land rather than a cutout.
 */
const HAZE = 0.7;

export interface HorizonCard {
  readonly type: HillName;
  readonly x: number;
  readonly z: number;
  /** Three `rotation.y`: the card's face (local +z) toward the ring's centre, give or take the jitter. */
  readonly yaw: number;
  readonly scale: number;
}

export interface HorizonPlacement {
  readonly centre: { readonly x: number; readonly z: number };
  readonly radius: number;
  /** World height of every card's base. */
  readonly baseY: number;
  readonly cards: readonly HorizonCard[];
}

/** Each hill card's authored width, read off its graph, so a re-export cannot leave a stale number here. */
export function hillWidths(): Record<HillName, number> {
  const out = {} as Record<HillName, number>;
  for (const name of HILL_NAMES) {
    const params = hillGraph(name).root.params;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i < params.length; i += 2) {
      min = Math.min(min, params[i]!);
      max = Math.max(max, params[i]!);
    }
    out[name] = max - min;
  }
  return out;
}

/**
 * The ring's cards, pure and deterministic in `seed`.
 *
 * The card count comes from the radius. Sixteen cards, the spec's number, leave gaps of hundreds of
 * metres on the shipped course, so the ring takes as many as it needs for the narrowest card at its
 * smallest scale, turned by the full yaw jitter, to still reach both neighbours. It never takes
 * fewer than `MIN_CARDS`.
 */
export function placeHorizon(
  bounds: Bounds,
  heightAt: (x: number, z: number) => number,
  seed: number,
): HorizonPlacement {
  const centre = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const radius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + RING_OFFSET_M;

  const widths = hillWidths();
  const narrowest = Math.min(...HILL_NAMES.map((name) => widths[name]));
  // A card at its narrowest reaches this far round the ring either side of its own centre.
  const reach = Math.atan(((narrowest * SCALE_MIN) / 2) * Math.cos(YAW_JITTER) / radius);
  const count = Math.max(MIN_CARDS, Math.ceil((2 * Math.PI) / (2 * reach)));

  let baseY = Infinity;
  const edge = (x: number, z: number): void => {
    const y = heightAt(x, z);
    if (Number.isFinite(y)) baseY = Math.min(baseY, y);
  };
  for (let x = bounds.minX; x <= bounds.maxX; x += EDGE_STEP_M) {
    edge(x, bounds.minZ);
    edge(x, bounds.maxZ);
  }
  for (let z = bounds.minZ; z <= bounds.maxZ; z += EDGE_STEP_M) {
    edge(bounds.minX, z);
    edge(bounds.maxX, z);
  }
  if (!Number.isFinite(baseY)) baseY = 0;
  baseY -= SINK_M;

  const random = mulberry32(seed);
  const cards: HorizonCard[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const jitter = (random() * 2 - 1) * YAW_JITTER;
    const scale = SCALE_MIN + random() * (SCALE_MAX - SCALE_MIN);
    cards.push({
      type: HILL_NAMES[i % HILL_NAMES.length]!,
      x: centre.x + Math.cos(angle) * radius,
      z: centre.z + Math.sin(angle) * radius,
      // rotation.y takes local +z to (sin yaw, cos yaw); that has to point back at the centre.
      yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)) + jitter,
      scale,
    });
  }
  return { centre, radius, baseY, cards };
}

export interface Horizon {
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

function hazeColour(): number {
  const from = BIOMES.parkland.foliageDark;
  const to = PARKLAND_SKY.horizon;
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 255;
    const b = (to >> shift) & 255;
    out |= Math.round(a + (b - a) * HAZE) << shift;
  }
  return out;
}

export function createHorizon(
  bounds: Bounds,
  heightAt: (x: number, z: number) => number,
  seed: number,
): Horizon {
  const placement = placeHorizon(bounds, heightAt, seed);
  const colour = { hill: hazeColour() };
  const up = new THREE.Vector3(0, 1, 0);
  // One merge per card type, then one geometry for the lot: a single draw for the whole ring.
  const parts: MergedGraph[] = [];
  for (const type of HILL_NAMES) {
    const matrices = placement.cards
      .filter((card) => card.type === type)
      .map((card) =>
        new THREE.Matrix4().compose(
          new THREE.Vector3(card.x, placement.baseY, card.z),
          new THREE.Quaternion().setFromAxisAngle(up, card.yaw),
          new THREE.Vector3(card.scale, card.scale, card.scale),
        ),
      );
    if (matrices.length > 0) parts.push(mergeGraphInstances(hillGraph(type), matrices, colour));
  }
  const geometry = mergeGeometries(parts.map((part) => part.mesh.geometry), false);
  for (const part of parts) part.dispose();
  if (geometry === null) throw new Error("horizon cards failed to merge");

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "horizon-hills";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The ring surrounds the camera, so its one bounding sphere is always in view anyway.
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
