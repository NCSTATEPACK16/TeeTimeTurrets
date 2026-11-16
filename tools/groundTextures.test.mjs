import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DETAIL_RANGE, GROUND_LAYERS } from "../src/render/groundLayers";
import { groundManifestProblem } from "../src/render/groundTextures";

/**
 * Smoke check for the packed ground textures (`tools/textures/packGround.mjs`): the committed
 * files are the shape `groundLayers.ts` expects, every layer's detail averages to "no change",
 * and no layer carries a slow light-to-dark drift that would show as a repeat when tiled.
 */
const dir = "public/textures/ground/";
const manifest = JSON.parse(readFileSync(`${dir}ground.json`, "utf8"));
const detail = readFileSync(`${dir}detail.bin`);
const normal = readFileSync(`${dir}normal.bin`);
const pixels = manifest.size * manifest.size;

describe("packed ground textures", () => {
  it("match the layer table", () => {
    expect(groundManifestProblem(manifest, detail.length, normal.length)).toBeNull();
    expect(manifest.detailRange).toBe(DETAIL_RANGE);
  });

  it("average to no change in every layer", () => {
    for (let layer = 0; layer < GROUND_LAYERS.length; layer++) {
      let sum = 0;
      for (let i = 0; i < pixels; i++) sum += detail[layer * pixels + i];
      // 127.5 is a multiplier of exactly 1. Clipping of the brightest texels pulls it down a little.
      expect(sum / pixels, GROUND_LAYERS[layer].name).toBeGreaterThan(121);
      expect(sum / pixels, GROUND_LAYERS[layer].name).toBeLessThan(130);
    }
  });

  it("carry no slow drift: every 128 px block's mean is within 3% of the layer's", () => {
    // A quarter of the width. Smaller blocks measure the grain itself: the rough's bright clumps
    // put one 64 px block 7.6% off, and that is detail, not drift.
    const block = 128;
    const per = manifest.size / block;
    for (let layer = 0; layer < GROUND_LAYERS.length; layer++) {
      let total = 0;
      const means = new Float64Array(per * per);
      for (let y = 0; y < manifest.size; y++) {
        for (let x = 0; x < manifest.size; x++) {
          const v = detail[layer * pixels + y * manifest.size + x];
          means[Math.floor(y / block) * per + Math.floor(x / block)] += v;
          total += v;
        }
      }
      const mean = total / pixels;
      let worst = 0;
      for (const m of means) worst = Math.max(worst, Math.abs(m / (block * block) - mean) / mean);
      expect(worst, GROUND_LAYERS[layer].name).toBeLessThan(0.03);
    }
  });

  it("hold unit-length-ish normals pointing up", () => {
    // The mean normal of a ground texture is straight up: x and y average to 0.5.
    for (let layer = 0; layer < GROUND_LAYERS.length; layer++) {
      let x = 0;
      let y = 0;
      for (let i = 0; i < pixels; i++) {
        x += normal[(layer * pixels + i) * 4];
        y += normal[(layer * pixels + i) * 4 + 1];
      }
      expect(Math.abs(x / pixels - 127.5), GROUND_LAYERS[layer].name).toBeLessThan(6);
      expect(Math.abs(y / pixels - 127.5), GROUND_LAYERS[layer].name).toBeLessThan(6);
    }
  });
});
