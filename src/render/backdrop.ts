import * as THREE from "three";
import { BIOMES } from "./biomes";
import { createGround } from "./ground";
import { createTrees } from "./Trees";
import { createTerrain } from "../sim/terrain";
import { createSurfaces } from "../sim/surfaces";
import type { HoleSpec } from "../sim/course";

/**
 * A live course scene with no simulation behind it: terrain, ground and trees only, under a
 * slowly orbiting camera. `UI-SPEC.md` S1 asks for exactly this behind the title panel, and
 * `ROADMAP.md` explains why it is worth the trouble -- a live backdrop forces the screen manager
 * to share one renderer with the round from day one, instead of that requirement being
 * discovered later at the clubhouse.
 *
 * `createTerrain` and `createSurfaces` are pure functions of a `HoleSpec`, so none of this needs
 * Rapier, a `Sim`, or a tick. It is the render half of a hole with the physics half never built.
 */

/** Radians per second. Slow enough to read as a living scene, not as a rotating turntable. */
const ORBIT_RATE = 0.035;
/** Low sun for the golden-hour look image 10 is lit with. */
const SUN_ELEVATION = 0.22;

export interface Backdrop {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Advance the orbit. `seconds` is wall time, not a fixed step: nothing here is simulated. */
  update(seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createBackdrop(spec: HoleSpec): Backdrop {
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  const palette = BIOMES[spec.biome];
  const fieldSize = spec.fieldSize;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.sky, fieldSize * 0.5, fieldSize * 2);

  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, fieldSize * 2.5);

  // Warmer and lower than the round's sun: this is the same course at a different hour, which is
  // most of what makes the menu read as a different place from the game.
  const sun = new THREE.DirectionalLight(0xffe6c0, 2.1);
  sun.position.set(fieldSize * 0.4, fieldSize * SUN_ELEVATION, fieldSize * 0.25);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbfd4ff, 0.5));

  const ground = createGround(terrain, surfaces);
  scene.add(ground.mesh);

  const trees = createTrees(terrain, surfaces);
  if (trees.mesh !== null) scene.add(trees.mesh);

  const centre = new THREE.Vector3(0, 0, 0);
  const radius = fieldSize * 0.32;
  const height = fieldSize * 0.09;
  let elapsed = 0;

  const update = (seconds: number): void => {
    elapsed += seconds;
    const angle = elapsed * ORBIT_RATE;
    camera.position.set(
      Math.cos(angle) * radius,
      terrain.heightAt(0, 0) + height,
      Math.sin(angle) * radius,
    );
    camera.lookAt(centre);
  };
  update(0);

  return {
    scene,
    camera,
    update,
    resize(width, height2) {
      camera.aspect = width / Math.max(1, height2);
      camera.updateProjectionMatrix();
    },
    dispose() {
      // Every allocation above, released here: the screen that owns this backdrop is rebuilt on
      // each entry, so anything missed accumulates once per visit to the title screen.
      scene.remove(ground.mesh);
      ground.dispose();
      if (trees.mesh !== null) scene.remove(trees.mesh);
      trees.dispose();
      scene.clear();
    },
  };
}
