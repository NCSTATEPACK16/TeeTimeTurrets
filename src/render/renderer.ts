import * as THREE from "three";
import type { QualityPreset } from "./quality";

/**
 * How every frame reaches the screen: sRGB output and tone mapping at one exposure, set in one
 * place so the game and the scene gate draw through the same pipeline and a gate screenshot means
 * what the player sees.
 *
 * **Neutral, not ACES.** Both roll highlights off rather than clipping them, which a lit scene with
 * a sky environment and a bright sun disc needs. ACES also shifts hues and drains saturation from
 * the mid-tones: measured against the parkland palette it turned the concept art's lime fairways
 * olive and its blue sky grey. Khronos PBR Neutral leaves the mid-tones where `biomes.ts` picked
 * them, which is the whole look of this game, and compresses only near white.
 */

/** Tuned by eye against the parkland palette under the Stage 3 sky and sun. */
export const EXPOSURE = 1.12;
export const TONE_MAPPING = THREE.NeutralToneMapping;

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = EXPOSURE;
}

/**
 * The parts of a preset that live on the renderer: the pixel-ratio cap, and whether shadow maps
 * exist at all. The rest is read by the scene when a match builds (`scene.ts`), so a changed preset
 * reaches the pixel ratio at once and everything else from the next match.
 */
export function applyQuality(renderer: THREE.WebGLRenderer, preset: QualityPreset, devicePixelRatio: number): void {
  renderer.setPixelRatio(Math.min(devicePixelRatio, preset.maxPixelRatio));
  renderer.shadowMap.enabled = preset.shadows !== "off";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
