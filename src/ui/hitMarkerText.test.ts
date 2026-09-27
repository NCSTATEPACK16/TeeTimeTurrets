import { describe, expect, it } from "vitest";
import { POINTS_PER_DAMAGE, POINTS_PER_KILL } from "../sim/scoring";
import { hitMarkerText } from "./hitMarkerText";

describe("hitMarkerText", () => {
  it("shows what a hit scored: ten points a point of damage", () => {
    expect(POINTS_PER_DAMAGE).toBe(10);
    expect(hitMarkerText("hit", 1)).toEqual({ label: "+10", variant: "hit-marker--hit" });
    expect(hitMarkerText("hit", 2)).toEqual({ label: "+20", variant: "hit-marker--hit" });
  });

  it("shows what a kill scored", () => {
    expect(POINTS_PER_KILL).toBe(100);
    expect(hitMarkerText("kill", 0)).toEqual({ label: "+100 ENEMY DOWN", variant: "hit-marker--kill" });
  });
});
