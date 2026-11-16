import { describe, expect, it } from "vitest";
import type { BiomeId } from "../sim/course";
import { BIOMES } from "./biomes";

/**
 * Smoke check for "one course, three variations" (the Caswell spec, section 3.1): the three
 * palettes are the same Piedmont course in slightly different light, not three climates. A
 * player driving from hole 5 to hole 6 should not see a border, and on every stretch the
 * fairway must still stand out from the rough.
 */

/** Rec. 709 relative luminance on sRGB bytes: the measure `tools/readSwatches.mjs` reports. */
function luminance(hex: number): number {
  return 0.2126 * ((hex >> 16) & 0xff) + 0.7152 * ((hex >> 8) & 0xff) + 0.0722 * (hex & 0xff);
}

const ids: readonly BiomeId[] = ["parkland", "links", "marsh"];

describe("the three palettes", () => {
  it("differ by at most 6 in luminance on every grass surface", () => {
    for (const field of ["green", "fairway", "rough"] as const) {
      const values = ids.map((id) => luminance(BIOMES[id][field]));
      expect(Math.max(...values) - Math.min(...values), field).toBeLessThanOrEqual(6);
    }
  });

  it("keep fairway, rough, green and sand apart within each", () => {
    for (const id of ids) {
      const p = BIOMES[id];
      expect(luminance(p.fairway) - luminance(p.rough), `${id} fairway over rough`).toBeGreaterThanOrEqual(25);
      expect(luminance(p.green) - luminance(p.fairway), `${id} green over fairway`).toBeGreaterThanOrEqual(20);
      expect(luminance(p.sand) - luminance(p.fairway), `${id} sand over fairway`).toBeGreaterThanOrEqual(25);
    }
  });

  it("share one sky, one water tint and one tree form", () => {
    for (const id of ids) {
      expect(BIOMES[id].sky, id).toBe(BIOMES.parkland.sky);
      expect(BIOMES[id].water, id).toBe(BIOMES.parkland.water);
      expect(BIOMES[id].treeForm, id).toBe("conifer");
    }
  });

  it("are all wooded: no stretch has under two-thirds of the densest one's trees", () => {
    const densities = ids.map((id) => BIOMES[id].treeDensity);
    expect(Math.min(...densities) / Math.max(...densities)).toBeGreaterThan(0.66);
  });
});
