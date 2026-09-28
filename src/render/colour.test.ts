import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TONE_MAPPING_EXPOSURE, applyColourPipeline } from "./colour";

describe("applyColourPipeline", () => {
  it("draws in sRGB through ACES filmic at the tuned exposure, with shadows available", () => {
    const renderer = {
      outputColorSpace: THREE.LinearSRGBColorSpace as string,
      toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, type: THREE.BasicShadowMap as THREE.ShadowMapType },
    };
    applyColourPipeline(renderer);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(TONE_MAPPING_EXPOSURE);
    // On for every preset: which lights cast is the preset's call, and switching the renderer's
    // shadow map on and off between screens does not reliably recompile what was built without it.
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });
});
