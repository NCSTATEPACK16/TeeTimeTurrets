import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { QualityPreset } from "./quality";

/**
 * High's post chain: the scene into a half-float target, ground-truth ambient occlusion darkening
 * creases and the undersides of overhangs (`docs/art/STYLE-RESEARCH.md` P4), a light bloom on what
 * is brighter than
 * white (the sun's disc, sparks, the pickup glows), SMAA, then tone mapping and sRGB in
 * `OutputPass` -- the same ACES and exposure `renderer.ts` sets, applied once at the end instead
 * of per material. Low and Med draw straight to the canvas with its MSAA, and get `null` here.
 */

/** Only HDR highlights bloom: linear values over this, before tone mapping. */
const BLOOM_THRESHOLD = 1.1;
const BLOOM_STRENGTH = 0.28;
const BLOOM_RADIUS = 0.45;

/**
 * AO at cart scale: a 1 m world-space radius reaches the seat well, the wheel arches and the
 * shade under a canopy or verandah without greying open ground; 0.6 m read as almost nothing from
 * the chase camera. `AO_SCALE` deepens it to the contact shading the concept sheets draw. Samples
 * and denoise stay at three's defaults, which `GTAOPass` already tunes for a single pass.
 */
const AO_RADIUS_M = 1;
const AO_SCALE = 1.5;
const AO_BLEND = 1;

export interface PostChain {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  preset: QualityPreset,
): PostChain | null {
  if (!preset.bloom && !preset.smaa && !preset.ambientOcclusion) return null;
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = preset.ambientOcclusion ? new GTAOPass(scene, camera, size.x, size.y) : null;
  if (ao) {
    ao.updateGtaoMaterial({ radius: AO_RADIUS_M, distanceFallOff: 1, thickness: 1, scale: AO_SCALE });
    ao.blendIntensity = AO_BLEND;
    composer.addPass(ao);
  }
  const bloom = preset.bloom ? new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD) : null;
  if (bloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const smaa = preset.smaa ? new SMAAPass() : null;
  if (smaa) composer.addPass(smaa);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  return {
    render() {
      composer.render();
    },
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    dispose() {
      ao?.dispose();
      bloom?.dispose();
      smaa?.dispose();
      composer.dispose();
    },
  };
}
