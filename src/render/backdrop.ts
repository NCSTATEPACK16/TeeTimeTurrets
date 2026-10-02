import * as THREE from "three";
import { Flagstick, placeFlagstick } from "../entities/Flagstick";
import { GOLDEN_HOUR_SKY, Sky } from "./sky";
import { createGround } from "./ground";
import { createProps } from "./props";
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
/** Linear sun intensity: the golden-hour sun, a little under the match's noon one. */
const SUN_INTENSITY = 2.9;
/** FogExp2 density times the hole's field size: a softer haze than the match, for depth. */
const FOG_DENSITY_X_FIELD = 0.9;

export interface Backdrop {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Advance the orbit. `seconds` is wall time, not a fixed step: nothing here is simulated. */
  update(seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * `renderer` bakes the sky's environment light and sizes the sun's shadow; without one (the tests,
 * in Node) the sky is drawn but lights through its hemisphere fill alone, and nothing casts.
 */
export function createBackdrop(spec: HoleSpec, renderer: THREE.WebGLRenderer | null = null): Backdrop {
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  const fieldSize = spec.fieldSize;

  const scene = new THREE.Scene();
  // Image 10's golden hour: the same course late in the day, which is most of what makes the menu
  // read as a different place from the game.
  const sky = new Sky(GOLDEN_HOUR_SKY, renderer);
  sky.install(scene, FOG_DENSITY_X_FIELD / fieldSize);

  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, fieldSize * 2.5);

  const sun = new THREE.DirectionalLight(sky.sunColour, SUN_INTENSITY);
  sun.position.copy(sky.sunDir).multiplyScalar(fieldSize);
  scene.add(sun);
  scene.add(sun.target);
  // Long low shadows across the fairway are the shot. One fixed map over the whole hole: nothing
  // moves but the camera, so there is nothing to snap.
  if (renderer?.shadowMap.enabled) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = fieldSize * 0.55;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = fieldSize * 2.5;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.25;
    sun.shadow.radius = 3;
  }

  const ground = createGround(terrain, surfaces);
  ground.mesh.receiveShadow = true;
  scene.add(ground.mesh);

  const trees = createTrees(terrain, surfaces);
  if (trees.mesh !== null) {
    trees.mesh.castShadow = true;
    scene.add(trees.mesh);
  }

  // The same factory the round uses, placed from the same `terrain.cupPosition`. This is the
  // second consumer `backdrop.test.ts` exists to keep honest: the title screen shows a real hole,
  // and a hole with nothing at the cup is the gap this whole change closes.
  const flagstick = new Flagstick();
  placeFlagstick(flagstick, terrain);
  scene.add(flagstick);

  const props = createProps(terrain, surfaces);
  for (const object of props.objects) scene.add(object);

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
    flagstick.update(elapsed);
    sky.update(elapsed);
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
      scene.remove(flagstick);
      flagstick.dispose();
      for (const object of props.objects) scene.remove(object);
      props.dispose();
      sky.dispose();
      sun.shadow.map?.dispose();
      scene.clear();
    },
  };
}
