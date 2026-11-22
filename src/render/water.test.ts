import { describe, expect, it } from "vitest";
import { QUALITY_PRESETS } from "./quality";
import { WATER_TUNING, waterWaves, waterWavesGlsl } from "./water";

/**
 * Smoke check for the ported pond waves (afl_ext's ocean, at the still-pond setting): the wave
 * sum stays in 0..1, actually varies across a pond and over time, and the GLSL the shader
 * compiles carries the same constants as the TypeScript reference beside it.
 */
describe("pond waves", () => {
  const iterations = QUALITY_PRESETS.med.waterIterations;

  it("stay in 0..1 and vary across a pond", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 4000; i++) {
      // A 40 m pond somewhere on the course, in wave units.
      const x = (-300 + (i % 64) * 0.63) * WATER_TUNING.waveScale;
      const z = (-160 + Math.floor(i / 64) * 0.63) * WATER_TUNING.waveScale;
      const h = waterWaves(x, z, 12.5, iterations);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.25);
  });

  it("move with time", () => {
    // The largest change at any of fifty points over 0.4 s. One point can sit near a turning
    // point of its own wave and barely move, so no single point is asked to.
    let most = 0;
    for (let i = 0; i < 50; i++) {
      const x = -750 + i * 1.7;
      const z = -400 + i * 0.9;
      most = Math.max(most, Math.abs(waterWaves(x, z, 3, iterations) - waterWaves(x, z, 3.4, iterations)));
    }
    expect(most).toBeGreaterThan(0.05);
  });

  it("compile to the same sum the reference computes", () => {
    const source = waterWavesGlsl(iterations);
    expect(source).toContain(`i < ${iterations};`);
    expect(source).toContain(`* ${WATER_TUNING.drag.toFixed(4)};`);
    for (const constant of ["frequency *= 1.18;", "timeMultiplier *= 1.07;", "iter += 1232.399963;", "mix(weight, 0.0, 0.2)"]) {
      expect(source).toContain(constant);
    }
  });

  it("cost more on better presets, up to the source's 36", () => {
    expect(QUALITY_PRESETS.low.waterIterations).toBeLessThan(QUALITY_PRESETS.med.waterIterations);
    expect(QUALITY_PRESETS.med.waterIterations).toBeLessThan(QUALITY_PRESETS.high.waterIterations);
    expect(QUALITY_PRESETS.high.waterIterations).toBe(36);
  });
});
