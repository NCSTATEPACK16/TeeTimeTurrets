import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PARKLAND_SKY, horizonFogColour, skyColourAt } from "./sky";

/** The fog is the dome's horizon, so far terrain dissolves into the sky rather than banding. */
describe("the sky's fog colour", () => {
  it("is the dome's gradient averaged round the horizon, not its zenith or its below-haze", () => {
    const fog = horizonFogColour(PARKLAND_SKY);
    const horizon = new THREE.Color(PARKLAND_SKY.horizon);
    // Level with the horizon and facing away from the sun, the dome is exactly its horizon colour.
    const away = skyColourAt(PARKLAND_SKY, 0, -1, { r: 0, g: 0, b: 0 });
    expect([away.r, away.g, away.b]).toEqual([horizon.r, horizon.g, horizon.b]);
    // The average adds only the sun's glow on one side: a little brighter than the horizon, and
    // nowhere near the zenith's blue.
    const zenith = new THREE.Color(PARKLAND_SKY.zenith);
    expect(fog.r).toBeGreaterThan(horizon.r);
    expect(fog.r - horizon.r).toBeLessThan(0.05);
    expect(Math.abs(fog.b - zenith.b)).toBeGreaterThan(0.1);
  });
});
