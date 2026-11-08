import { describe, expect, it } from "vitest";
import { CART_TUNING, TIRE_TUNING, TireType } from "./entities/Cart";
import { cartSpeedScale, maxClimbRad } from "./mobility";
import { SURFACES, SurfaceId } from "./surfaces";
import { uphillDriveMargin } from "../vendor/cot/terrainMobility";

/** The plan's three cases (REVAMP-PLAN Stage 4, #49), plus the closed form held to the vendored margin. */

const street = TIRE_TUNING[TireType.Street];
const knobby = TIRE_TUNING[TireType.Knobby];
const scaleOf = (id: SurfaceId): number => SURFACES[id].cartSpeedScale;
const speed = (tire = street, id: SurfaceId): number =>
  cartSpeedScale(tire, scaleOf(id), CART_TUNING.minSurfaceScale);
const climbDeg = (tire = street, id: SurfaceId): number =>
  (maxClimbRad(tire, scaleOf(id), CART_TUNING.accel) * 180) / Math.PI;

describe("the mobility table", () => {
  it("makes rough slower than fairway", () => {
    expect(speed(street, SurfaceId.Fairway)).toBe(1);
    expect(speed(street, SurfaceId.Rough)).toBeCloseTo(1 / 1.4, 9);
  });

  it("blocks a steep sand climb that fairway allows", () => {
    // 30 degrees: between the two limits, so the same grade is a climb on one and a wall on the other.
    expect(climbDeg(street, SurfaceId.Fairway)).toBeGreaterThan(30);
    expect(climbDeg(street, SurfaceId.Sand)).toBeLessThan(30);
  });

  it("gives knobby tyres the edge over street tyres off-road, and not on the fairway", () => {
    expect(speed(knobby, SurfaceId.Rough)).toBeGreaterThan(speed(street, SurfaceId.Rough));
    expect(speed(knobby, SurfaceId.Sand)).toBeGreaterThan(speed(street, SurfaceId.Sand));
    expect(climbDeg(knobby, SurfaceId.Sand)).toBeGreaterThan(climbDeg(street, SurfaceId.Sand));
    // The control: on the fairway the trade runs the other way, so the edge is the ground's doing.
    expect(speed(knobby, SurfaceId.Fairway)).toBeLessThan(speed(street, SurfaceId.Fairway));
  });

  it("puts the climb limit exactly where the vendored drive margin runs out", () => {
    for (const id of [SurfaceId.Fairway, SurfaceId.Rough, SurfaceId.Sand]) {
      const limit = maxClimbRad(street, scaleOf(id), CART_TUNING.accel);
      // The spec the vendored function needs, at the resistance a street tyre feels here.
      const spec = {
        terrainResistance: { [id]: 1 / scaleOf(id) },
        enginePowerHp: 1e6,
        weightTons: 1,
        trackTraction: street.grip,
      };
      expect(uphillDriveMargin(spec, id, limit - 0.01)).toBeGreaterThan(0);
      expect(uphillDriveMargin(spec, id, limit + 0.01)).toBe(0);
    }
  });
});
