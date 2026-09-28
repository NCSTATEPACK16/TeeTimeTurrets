import { describe, expect, it } from "vitest";
import { SURFACES, SurfaceId } from "./surfaces";
import { TireType } from "./entities/Cart";
import { maxClimbRad, resistanceOf } from "./mobility";

const deg = (rad: number): number => (rad * 180) / Math.PI;

describe("mobility", () => {
  it("reads a surface's resistance from its speed penalty, so the two cannot disagree", () => {
    expect(resistanceOf(SURFACES[SurfaceId.Fairway], TireType.Street)).toBeCloseTo(1, 6);
    expect(resistanceOf(SURFACES[SurfaceId.Rough], TireType.Street)).toBeGreaterThan(1.3);
    expect(resistanceOf(SURFACES[SurfaceId.Sand], TireType.Street)).toBeGreaterThan(
      resistanceOf(SURFACES[SurfaceId.Rough], TireType.Street),
    );
  });

  it("climbs less on rough than on fairway", () => {
    const fairway = maxClimbRad(SURFACES[SurfaceId.Fairway], TireType.Street);
    const rough = maxClimbRad(SURFACES[SurfaceId.Rough], TireType.Street);
    expect(rough).toBeLessThan(fairway - 0.05);
  });

  it("stops a cart on a sand grade that fairway climbs", () => {
    const grade = (28 * Math.PI) / 180;
    expect(maxClimbRad(SURFACES[SurfaceId.Fairway], TireType.Street)).toBeGreaterThan(grade);
    expect(maxClimbRad(SURFACES[SurfaceId.Sand], TireType.Street)).toBeLessThan(grade);
  });

  it("lets knobby tyres climb rough and sand that street tyres cannot", () => {
    for (const id of [SurfaceId.Rough, SurfaceId.Sand]) {
      expect(maxClimbRad(SURFACES[id], TireType.Knobby)).toBeGreaterThan(maxClimbRad(SURFACES[id], TireType.Street) + 0.03);
    }
  });

  it("keeps every climb between a gentle slope and a wall", () => {
    for (const id of Object.values(SurfaceId)) {
      for (const tire of Object.values(TireType)) {
        const climb = deg(maxClimbRad(SURFACES[id], tire));
        expect(climb).toBeGreaterThan(8);
        expect(climb).toBeLessThan(46);
      }
    }
  });
});
