import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { shadowNormalBiasForTexel, snapShadowCoordinate } from "../vendor/cot/shadowStability";
import type { QualityPreset } from "./quality";

/**
 * The sun's shadows, by preset.
 *
 * - **Off (Low):** the sun lights but casts nothing.
 * - **Single (Med):** one map, `SINGLE_HALF_EXTENT_M` either side of the camera's target, moved in
 *   whole shadow-map texels (`snapShadowCoordinate`), so a cart's shadow does not crawl or shimmer
 *   as the camera follows it. Normal bias scales with the texel (`shadowNormalBiasForTexel`).
 * - **Cascaded (High):** three's CSM over the view, which must exist before any lit material
 *   compiles: every standard material in the scene is set up with it at build time
 *   (`setupMaterials`), and handed back untouched by `dispose`, because carts share materials with
 *   the title and the clubhouse showroom.
 */

/** Half the side of Med's shadow box, in metres: the fight around the player. */
export const SINGLE_HALF_EXTENT_M = 55;
/** How far the light sits back from its target along the sun direction. */
const LIGHT_DISTANCE_M = 220;
/** Cascades reach this far; beyond it the fog has the terrain anyway. */
const CSM_MAX_FAR_M = 360;

export interface SunShadows {
  /** Follow the camera's target. Called once per frame before rendering. */
  update(focus: THREE.Vector3): void;
  /** The camera's projection changed (the FOV kick): High's cascade splits follow it. */
  projectionChanged(): void;
  /** High only: patch every standard material under `root` for the cascades. */
  setupMaterials(root: THREE.Object3D): void;
  /** High only: patch one material made after the scene was built (a ground tile). */
  patchMaterial(material: THREE.Material): void;
  dispose(): void;
}

/**
 * Light space for a sun shining along `-sunDir`: an orthonormal basis whose third axis is the sun
 * direction. Snapping a point's first two coordinates in this basis is what keeps the map still.
 */
export function lightBasis(sunDir: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const helper = Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(helper, sunDir).normalize();
  const up = new THREE.Vector3().crossVectors(sunDir, right).normalize();
  return { right, up };
}

/** `focus` moved to the nearest texel corner in light space, written into `out`. */
export function snapFocus(
  focus: THREE.Vector3,
  basis: { right: THREE.Vector3; up: THREE.Vector3 },
  sunDir: THREE.Vector3,
  metresPerTexel: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const u = snapShadowCoordinate(focus.dot(basis.right), metresPerTexel);
  const v = snapShadowCoordinate(focus.dot(basis.up), metresPerTexel);
  const w = focus.dot(sunDir);
  return out
    .copy(basis.right)
    .multiplyScalar(u)
    .addScaledVector(basis.up, v)
    .addScaledVector(sunDir, w);
}

export function createSunShadows(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  sunDir: THREE.Vector3,
  preset: QualityPreset,
): SunShadows {
  if (preset.shadows === "off") {
    sun.castShadow = false;
    return { update() {}, projectionChanged() {}, setupMaterials() {}, patchMaterial() {}, dispose() {} };
  }
  if (preset.shadows === "single") return singleMap(sun, sunDir, preset.shadowMapSize);
  return cascaded(scene, camera, sun, sunDir, preset);
}

function singleMap(sun: THREE.DirectionalLight, sunDir: THREE.Vector3, mapSize: number): SunShadows {
  const metresPerTexel = (SINGLE_HALF_EXTENT_M * 2) / mapSize;
  const basis = lightBasis(sunDir);
  const snapped = new THREE.Vector3();
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const cam = sun.shadow.camera;
  cam.left = -SINGLE_HALF_EXTENT_M;
  cam.right = SINGLE_HALF_EXTENT_M;
  cam.top = SINGLE_HALF_EXTENT_M;
  cam.bottom = -SINGLE_HALF_EXTENT_M;
  cam.near = 1;
  cam.far = LIGHT_DISTANCE_M * 2;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = shadowNormalBiasForTexel(metresPerTexel);
  sun.shadow.radius = 3;
  return {
    update(focus) {
      snapFocus(focus, basis, sunDir, metresPerTexel, snapped);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, LIGHT_DISTANCE_M);
      sun.target.updateMatrixWorld();
    },
    projectionChanged() {},
    setupMaterials() {},
    patchMaterial() {},
    dispose() {
      sun.castShadow = false;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
  };
}

interface Patched {
  material: THREE.Material;
  onBeforeCompile: THREE.Material["onBeforeCompile"];
  hadDefines: boolean;
}

function cascaded(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  sunDir: THREE.Vector3,
  preset: QualityPreset,
): SunShadows {
  // CSM brings its own lights, one per cascade; the plain sun steps aside.
  sun.visible = false;
  sun.castShadow = false;
  const csm = new CSM({
    camera,
    parent: scene,
    cascades: preset.shadowCascades,
    maxFar: Math.min(CSM_MAX_FAR_M, camera.far),
    mode: "practical",
    shadowMapSize: preset.shadowMapSize,
    lightDirection: sunDir.clone().negate(),
    lightIntensity: sun.intensity,
    lightNear: 1,
    lightFar: 1200,
    lightMargin: 120,
    shadowBias: -0.0002,
  });
  csm.fade = true;
  for (const light of csm.lights) {
    light.color.copy(sun.color);
    light.shadow.radius = 2;
    light.shadow.normalBias = 0.06;
  }
  const patched: Patched[] = [];
  const seen = new Set<THREE.Material>();
  const patch = (material: THREE.Material): void => {
    if (seen.has(material)) return;
    seen.add(material);
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    const prior = material.onBeforeCompile;
    const hadDefines = material.defines !== undefined;
    patched.push({ material, onBeforeCompile: prior, hadDefines });
    csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    // Chained, so the ground's own shader rewrite still runs.
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      csmHook.call(material, shader, renderer);
    };
    material.needsUpdate = true;
  };
  return {
    update() {
      csm.update();
    },
    projectionChanged() {
      csm.updateFrustums();
    },
    setupMaterials(root) {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) patch(material);
      });
    },
    patchMaterial: patch,
    dispose() {
      for (const { material, onBeforeCompile, hadDefines } of patched) {
        material.onBeforeCompile = onBeforeCompile;
        const defines = (material as THREE.MeshStandardMaterial).defines;
        if (defines) {
          delete defines.USE_CSM;
          delete defines.CSM_CASCADES;
          delete defines.CSM_FADE;
          if (!hadDefines && Object.keys(defines).length === 0) (material as THREE.MeshStandardMaterial).defines = undefined;
        }
        material.needsUpdate = true;
      }
      csm.remove();
      csm.dispose();
      sun.visible = true;
    },
  };
}
