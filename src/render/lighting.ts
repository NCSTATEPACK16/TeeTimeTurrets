import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { shadowNormalBiasForTexel, snapShadowCoordinate } from "../vendor/cot/shadowStability";
import type { QualityPreset } from "./quality";
import { SKY, sunDirection } from "./sky";
import type { Direction, SkyStyle } from "./sky";

/**
 * The match's light: a sun from the sky's own direction, a hemisphere bounce between the sky and
 * the grass, and shadows as the quality preset says.
 *
 * - **Low:** no shadows.
 * - **Medium:** one directional shadow map that follows the camera, its centre snapped to whole
 *   texels in the light's plane so its edges do not crawl as the cart drives, and its normal bias
 *   scaled to the texel (`src/vendor/cot/shadowStability.ts`).
 * - **High:** three.js's cascaded shadow maps. CSM draws with one light per cascade and a shader
 *   that picks the cascade, so every lit material in the scene has to be set up for it before it
 *   compiles -- a material that is not sees every cascade's light at once. `adopt` sets up whatever
 *   the scene has, and is called again when the ground builds new tiles.
 *
 * The environment map from `sky.ts` is the rest of the ambient; the levels below are balanced
 * against it under ACES tone mapping (`colour.ts`).
 */

export const LIGHT_LEVELS = {
  sun: 2.6,
  hemisphere: 0.55,
  /** `scene.environmentIntensity`: the sky's image-based light. */
  environment: 0.45,
} as const;

/** Metres of ground per shadow texel for the single map, whose square side is `shadowFar`. */
export function shadowTexelSize(preset: QualityPreset): number {
  return preset.shadowFar / preset.shadowMapSize;
}

/**
 * The point (x, y, z) snapped to whole texels across the light and left alone along it.
 *
 * The shadow camera looks down the sun's rays; moving its centre by a fraction of a texel resamples
 * every shadow edge differently, which is the crawl. Moving it only in whole texels in the light's
 * own plane keeps every texel over the same patch of ground.
 */
export function snapShadowFocus(
  x: number,
  y: number,
  z: number,
  sun: Direction,
  texel: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  // The light looks along -sun. `right` = along x worldUp, `up` = right x along.
  const n = Math.hypot(sun.x, sun.y, sun.z);
  const ax = -sun.x / n;
  const ay = -sun.y / n;
  const az = -sun.z / n;
  let rx = -az;
  const ry = 0;
  let rz = ax;
  const rn = Math.hypot(rx, rz);
  rx /= rn;
  rz /= rn;
  const ux = ry * az - rz * ay;
  const uy = rz * ax - rx * az;
  const uz = rx * ay - ry * ax;

  const a = snapShadowCoordinate(x * rx + y * ry + z * rz, texel);
  const b = snapShadowCoordinate(x * ux + y * uy + z * uz, texel);
  const c = x * ax + y * ay + z * az;
  return out.set(rx * a + ux * b + ax * c, ry * a + uy * b + ay * c, rz * a + uz * b + az * c);
}

/**
 * Chains a change onto a material's shader hook and program key, and returns the undo.
 *
 * `apply` may replace `onBeforeCompile` outright, as `CSM.setupMaterial` does; the material's own
 * hook -- the ground's whole shader -- still runs first. The program key gains `key`, so a patched
 * material never shares a compiled program with an unpatched one: three.js keys programs by the
 * hook's source text by default, and every wrapper's text is the same.
 */
export function patchMaterial(material: THREE.Material, key: string, apply: (material: THREE.Material) => void): () => void {
  const ownHook = material.onBeforeCompile;
  const ownKey = material.customProgramCacheKey;
  const ownDefines = material.defines === undefined ? undefined : { ...material.defines };
  const baseKey = ownKey.call(material);

  apply(material);
  const addedHook = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    ownHook.call(this, shader, renderer);
    if (addedHook !== ownHook) addedHook.call(this, shader, renderer);
  };
  material.customProgramCacheKey = () => `${baseKey}|${key}`;
  material.needsUpdate = true;

  return () => {
    material.onBeforeCompile = ownHook;
    material.customProgramCacheKey = ownKey;
    material.defines = ownDefines === undefined ? undefined : { ...ownDefines };
    material.needsUpdate = true;
  };
}

export interface Lighting {
  /** Call once a frame, after the camera has moved and before the scene is drawn. */
  update(camera: THREE.PerspectiveCamera): void;
  /** Sets up any lit material under `root` not yet set up. Only cascaded shadows need it. */
  adopt(root: THREE.Object3D): void;
  dispose(): void;
}

/** How far along the camera's view the single map's centre sits, as a share of its half-width. */
const FOCUS_AHEAD = 0.6;
/** Metres the single shadow camera stands back from its focus along the sun's rays. */
const SUN_STANDOFF_M = 300;

export function createLighting(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  preset: QualityPreset,
  style: SkyStyle = SKY,
): Lighting {
  const sunDir = sunDirection(style);
  const hemisphere = new THREE.HemisphereLight(style.zenith, style.ground, LIGHT_LEVELS.hemisphere);
  scene.add(hemisphere);

  if (preset.shadows === "cascaded") return cascaded(scene, camera, preset, style, sunDir, hemisphere);

  const sun = new THREE.DirectionalLight(style.sunColour, LIGHT_LEVELS.sun);
  sun.position.set(sunDir.x * SUN_STANDOFF_M, sunDir.y * SUN_STANDOFF_M, sunDir.z * SUN_STANDOFF_M);
  scene.add(sun, sun.target);

  const single = preset.shadows === "single";
  const texel = single ? shadowTexelSize(preset) : 0;
  if (single) {
    const half = preset.shadowFar / 2;
    sun.castShadow = true;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -half;
    shadowCamera.right = half;
    shadowCamera.top = half;
    shadowCamera.bottom = -half;
    shadowCamera.near = 1;
    shadowCamera.far = SUN_STANDOFF_M * 2;
    shadowCamera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = shadowNormalBiasForTexel(texel);
  }
  const forward = new THREE.Vector3();
  const focus = new THREE.Vector3();

  return {
    update(view: THREE.PerspectiveCamera): void {
      if (!single) return;
      // The map covers the ground ahead of the camera, where the carts being fought over are.
      view.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
      forward.normalize();
      const ahead = (preset.shadowFar / 2) * FOCUS_AHEAD;
      snapShadowFocus(
        view.position.x + forward.x * ahead,
        view.position.y,
        view.position.z + forward.z * ahead,
        sunDir,
        texel,
        focus,
      );
      sun.target.position.copy(focus);
      sun.position.set(focus.x + sunDir.x * SUN_STANDOFF_M, focus.y + sunDir.y * SUN_STANDOFF_M, focus.z + sunDir.z * SUN_STANDOFF_M);
      sun.target.updateMatrixWorld();
    },
    adopt(): void {},
    dispose(): void {
      scene.remove(hemisphere, sun, sun.target);
      sun.dispose();
      hemisphere.dispose();
    },
  };
}

function cascaded(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  preset: QualityPreset,
  style: SkyStyle,
  sunDir: Direction,
  hemisphere: THREE.HemisphereLight,
): Lighting {
  const csm = new CSM({
    camera,
    parent: scene,
    cascades: preset.shadowCascades,
    maxFar: preset.shadowFar,
    mode: "practical",
    shadowMapSize: preset.shadowMapSize,
    shadowBias: -0.0003,
    lightDirection: new THREE.Vector3(-sunDir.x, -sunDir.y, -sunDir.z).normalize(),
    lightIntensity: LIGHT_LEVELS.sun,
    lightMargin: 120,
  });
  csm.fade = true;
  for (const light of csm.lights) {
    light.color.setHex(style.sunColour);
    // CSM's own bias is one number for every cascade; the far ones have bigger texels.
    const texel = (light.shadow.camera.right - light.shadow.camera.left) / preset.shadowMapSize;
    light.shadow.normalBias = shadowNormalBiasForTexel(texel);
  }

  const restores = new Map<THREE.Material, () => void>();
  const setup = (material: THREE.Material): void => {
    if (restores.has(material) || !isLit(material)) return;
    restores.set(material, patchMaterial(material, "csm", (m) => csm.setupMaterial(m)));
  };
  const visit = (object: THREE.Object3D): void => {
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material === undefined) return;
    if (Array.isArray(material)) material.forEach(setup);
    else setup(material);
  };
  let lastFov = camera.fov;
  let lastAspect = camera.aspect;

  return {
    update(view: THREE.PerspectiveCamera): void {
      // The chase camera's FOV kicks with speed; the cascades are cut from its frustum.
      if (Math.abs(view.fov - lastFov) > 0.5 || view.aspect !== lastAspect) {
        lastFov = view.fov;
        lastAspect = view.aspect;
        csm.updateFrustums();
      }
      csm.update();
    },
    adopt(root: THREE.Object3D): void {
      root.traverse(visit);
    },
    dispose(): void {
      for (const restore of restores.values()) restore();
      restores.clear();
      csm.remove();
      csm.dispose();
      for (const light of csm.lights) light.dispose();
      scene.remove(hemisphere);
      hemisphere.dispose();
    },
  };
}

function isLit(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial
  );
}
