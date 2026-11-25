import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, physicsConfig } from './physicsConfig';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/** Loads Rapier's WASM once. Works in browsers and in Node (Vitest). */
export function initRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/** A world with project gravity and a fixed 60 Hz step. */
export function createWorld(R: Rapier): RAPIER.World {
  const world = new R.World({ x: 0, y: physicsConfig.gravity, z: 0 });
  world.timestep = FIXED_DT;
  return world;
}
