import * as THREE from "three";
import { Flagstick, placeFlagstick } from "../entities/Flagstick";
import { createSkyMaterial, fogDensityFor, skyColourAt, sunDirection } from "./sky";
import type { SkyStyle } from "./sky";
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

export interface Backdrop {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Advance the orbit. `seconds` is wall time, not a fixed step: nothing here is simulated. */
  update(seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * The title's sky: the same course late in the day. A low warm sun and a hazy peach horizon under
 * a deeper blue, which is most of what makes the menu read as a different place from the match.
 */
export const GOLDEN_HOUR: SkyStyle = {
  zenith: 0x35609c,
  horizon: 0xf2c28d,
  ground: 0x4f5a3a,
  exponent: 0.45,
  sunColour: 0xffc98a,
  sunElevationDeg: 9,
  sunAzimuthDeg: 30,
  sunGlow: 0.7,
  sunGlowPower: 6,
  sunDiscCos: Math.cos((1.1 * Math.PI) / 180),
  sunDiscIntensity: 5,
};
export function createBackdrop(spec: HoleSpec): Backdrop {
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  const fieldSize = spec.fieldSize;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, fieldSize * 2.5);

  // The sky model drawn on a dome, and fog in its horizon colour away from the sun, from the model
  // itself: the title has no baked environment to read the horizon back from, and needs none.
  const sunDir = sunDirection(GOLDEN_HOUR);
  const horizon = new THREE.Color();
  skyColourAt(GOLDEN_HOUR, -sunDir.x, 0, -sunDir.z, horizon);
  scene.background = horizon.clone();
  scene.fog = new THREE.FogExp2(horizon.getHex(), fogDensityFor(fieldSize * 1.4, 0.95));
  const domeGeometry = new THREE.SphereGeometry(fieldSize * 2.2, 32, 16);
  const domeMaterial = createSkyMaterial(GOLDEN_HOUR);
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(GOLDEN_HOUR.sunColour, 2.2);
  sun.position.set(sunDir.x * fieldSize, sunDir.y * fieldSize, sunDir.z * fieldSize);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(GOLDEN_HOUR.zenith, GOLDEN_HOUR.ground, 0.9));

  const ground = createGround(terrain, surfaces);
  scene.add(ground.mesh);

  const trees = createTrees(terrain, surfaces);
  if (trees.mesh !== null) scene.add(trees.mesh);

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
      scene.remove(dome);
      domeGeometry.dispose();
      domeMaterial.dispose();
      scene.remove(flagstick);
      flagstick.dispose();
      for (const object of props.objects) scene.remove(object);
      props.dispose();
      scene.clear();
    },
  };
}
