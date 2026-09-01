import { describe, expect, it } from "vitest";
import type { HoleSpec, Vec2 } from "./course";
import { createSurfaces } from "./surfaces";
import { createTerrain } from "./terrain";

/**
 * A HoleSpec distinct from fixedHoleSpec() in every field that feeds sandChannel or the
 * fairway corridor, so this exercises createSurfaces' default (non-fixed-source) code path
 * rather than accidentally retracing the fixture's numbers.
 */
function nonLegacySpec(): HoleSpec {
  const tee: Vec2 = { x: -40, z: 12 };
  const cup: Vec2 = { x: 30, z: -18 };
  return {
    seed: 0x1234abcd,
    index: 2,
    fieldSize: 160,
    cells: 160,
    tee,
    cup,
    control: [tee, { x: (tee.x + cup.x) / 2, z: (tee.z + cup.z) / 2 }, cup],
    par: 4,
    waterLevel: -0.72,
  };
}

const AXIS: readonly number[] = [-60, -35, -10, 15, 40, 60];

describe("createSurfaces default sand source (no sources override)", () => {
  it("classifies deterministically for a fixed seed", () => {
    const spec = nonLegacySpec();
    const terrain = createTerrain(spec);
    const a = createSurfaces(spec, terrain);
    const b = createSurfaces(spec, terrain);

    for (const x of AXIS) {
      for (const z of AXIS) {
        expect(() => a.surfaceAt(x, z)).not.toThrow();
        expect(b.surfaceAt(x, z)).toBe(a.surfaceAt(x, z));
      }
    }
  });

  it("draws sand noise from mulberry32(sandChannel(spec)), not a fixed constant source", () => {
    const spec = nonLegacySpec();
    const terrain = createTerrain(spec);
    const withDefaultSource = createSurfaces(spec, terrain);
    const withFixedConstantSource = createSurfaces(spec, terrain, { sand: () => 0.77 });

    let sawDifference = false;
    for (const x of AXIS) {
      for (const z of AXIS) {
        if (withDefaultSource.surfaceAt(x, z) !== withFixedConstantSource.surfaceAt(x, z)) {
          sawDifference = true;
        }
      }
    }

    expect(sawDifference).toBe(true);
  });
});
