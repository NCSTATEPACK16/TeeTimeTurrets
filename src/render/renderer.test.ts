import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EXPOSURE, TONE_MAPPING, applyQuality, configureRenderer } from "./renderer";
import { QUALITY_PRESETS } from "./quality";

/** The slice of `WebGLRenderer` these touch, recorded. Node has no WebGL to build a real one. */
function fakeRenderer(): THREE.WebGLRenderer & { ratio: number } {
  const fake = {
    ratio: 0,
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    setPixelRatio(r: number) {
      fake.ratio = r;
    },
  };
  return fake as unknown as THREE.WebGLRenderer & { ratio: number };
}

describe("the colour pipeline", () => {
  it("writes sRGB and tone-maps with PBR Neutral at the tuned exposure", () => {
    const r = fakeRenderer();
    configureRenderer(r);
    expect(r.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(TONE_MAPPING).toBe(THREE.NeutralToneMapping);
    expect(r.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(r.toneMappingExposure).toBe(EXPOSURE);
  });
});

describe("a preset applied", () => {
  it("caps the pixel ratio at the preset's, and never raises it above the device's", () => {
    const r = fakeRenderer();
    applyQuality(r, QUALITY_PRESETS.med, 2);
    expect(r.ratio).toBe(QUALITY_PRESETS.med.maxPixelRatio);
    applyQuality(r, QUALITY_PRESETS.high, 1);
    expect(r.ratio).toBe(1);
  });

  it("turns shadow maps on only where the preset has shadows, soft where it does", () => {
    const r = fakeRenderer();
    applyQuality(r, QUALITY_PRESETS.low, 1);
    expect(r.shadowMap.enabled).toBe(false);
    applyQuality(r, QUALITY_PRESETS.med, 1);
    expect(r.shadowMap.enabled).toBe(true);
    expect(r.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });
});
