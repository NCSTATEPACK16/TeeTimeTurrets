import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "../sim/course";
import { createTerrain } from "../sim/terrain";
import { buildMapHoles, nearestHoleNumber } from "./courseMapHoles";

describe("buildMapHoles", () => {
  it("numbers each hole from its spec and places it where the course put it", () => {
    const spec = { ...fixedHoleSpec(), index: 8 };
    const placement = { index: 8, offsetX: 120, offsetZ: -40, rotation: 0.3 };
    const [hole] = buildMapHoles([{ spec, terrain: createTerrain(spec), placement }]);
    expect(hole!.number).toBe(9);
    expect(hole!.field).toEqual({ fieldSize: spec.fieldSize, offsetX: 120, offsetZ: -40, rotation: 0.3 });
    expect(hole!.runs.length).toBeGreaterThan(0);
    expect(hole!.tee).toEqual(spec.tee);
  });
});

describe("nearestHoleNumber", () => {
  const placements = [
    { index: 0, offsetX: 0, offsetZ: 0, rotation: 0 },
    { index: 8, offsetX: 300, offsetZ: 0, rotation: 0 },
  ];

  it("frames the hole whose middle the player is closest to, by its printed number", () => {
    expect(nearestHoleNumber(placements, 10, 5)).toBe(1);
    expect(nearestHoleNumber(placements, 280, -20)).toBe(9);
  });
});
