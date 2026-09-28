import * as THREE from "three";

/**
 * The renderer's colour pipeline: shading in linear light, ACES filmic tone mapping, sRGB out.
 *
 * Shared by the game (`main.ts`) and the scene gate's harness, so a gate subject is drawn the way
 * the game draws it. Tone mapping belongs to the final write: a render target is not tone-mapped,
 * which is what lets the sky's horizon be read back in linear light and a composer apply the
 * mapping once, in its output pass.
 */

/**
 * ACES darkens mid-tones as it rolls off highlights. The palettes in `biomes.ts` were sampled for a
 * renderer with no tone mapping, so the exposure lifts the lit ground back to about the brightness
 * those palettes were tuned at; the gate's course-ground subject is where that was measured.
 */
export const TONE_MAPPING_EXPOSURE = 1.0;

export interface ColourPipelineTarget {
  outputColorSpace: string;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
}

export function applyColourPipeline(renderer: ColourPipelineTarget): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
