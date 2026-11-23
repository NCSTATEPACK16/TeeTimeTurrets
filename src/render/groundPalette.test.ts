import { describe, expect, it } from "vitest";
import { BIOMES } from "./biomes";
import { groundColourAt } from "./groundPalette";
import type { GroundSample, LinearRgb } from "./groundPalette";
import { STRAW_COLOUR } from "./groundShader";

/**
 * Smoke check for the TypeScript palette blend: at each surface's full weight it returns that
 * surface's colour, so a grass tuft is painted what the ground under it is painted.
 */
const srgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (hex: number): [number, number, number] => [
  srgb(((hex >> 16) & 255) / 255),
  srgb(((hex >> 8) & 255) / 255),
  srgb((hex & 255) / 255),
];

describe("groundColourAt", () => {
  const out: LinearRgb = { r: 0, g: 0, b: 0 };
  const base: GroundSample = { x: 10, z: 20, green: 1, corridor: 0, sand: 0, water: 0, biome: [1, 0, 0], woods: 0, up: 1 };
  const colourOf = (sample: Partial<GroundSample>): number[] => {
    groundColourAt({ ...base, ...sample }, out);
    return [out.r, out.g, out.b];
  };
  const expectClose = (actual: number[], expected: number[]): void => {
    for (let k = 0; k < 3; k++) expect(actual[k]).toBeCloseTo(expected[k]!, 5);
  };

  it("is the fairway colour on the fairway", () => {
    expectClose(colourOf({}), linear(BIOMES.parkland.fairway));
  });

  it("is the rough colour in full rough", () => {
    expectClose(colourOf({ corridor: 1 }), linear(BIOMES.parkland.rough));
  });

  it("is the green colour on the putting surface", () => {
    expectClose(colourOf({ green: 0 }), linear(BIOMES.parkland.green));
  });

  it("is pine straw in full woods", () => {
    expectClose(colourOf({ corridor: 1, woods: 1 }), linear(STRAW_COLOUR));
  });

  it("mixes the biomes by their shares", () => {
    const a = linear(BIOMES.parkland.rough);
    const b = linear(BIOMES.marsh.rough);
    expectClose(colourOf({ corridor: 1, biome: [1, 0, 1] }), a.map((v, k) => (v + b[k]!) / 2));
  });
});
