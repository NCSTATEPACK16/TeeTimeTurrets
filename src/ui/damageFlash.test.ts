import { describe, expect, it } from "vitest";
import { DAMAGE_FLASH_SECONDS, DamageFlashes, damageBearing } from "./damageFlash";

describe("damageBearing", () => {
  // The camera looks along the turret. Looking down +X, +Z is to the screen's right.
  it("is 0 for a shot from straight ahead", () => {
    expect(damageBearing(0, 0, 0, 10, 0)).toBeCloseTo(0, 9);
  });

  it("is a quarter turn clockwise for a shot from the right", () => {
    expect(damageBearing(0, 0, 0, 0, 10)).toBeCloseTo(Math.PI / 2, 9);
    expect(damageBearing(0, 0, 0, 0, -10)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("is a half turn for a shot from behind, and follows the camera round", () => {
    expect(Math.abs(damageBearing(0, 0, 0, -10, 0))).toBeCloseTo(Math.PI, 9);
    // Turned to face +Z, the same shot from +Z is now dead ahead.
    expect(damageBearing(0, 0, Math.PI / 2, 0, 10)).toBeCloseTo(0, 9);
  });
});

describe("DamageFlashes", () => {
  it("fades a flash out over its life, then drops it", () => {
    const flashes = new DamageFlashes();
    flashes.push(1);
    expect(flashes.active).toEqual([{ bearing: 1, alpha: 1 }]);
    flashes.update(DAMAGE_FLASH_SECONDS / 2);
    expect(flashes.active[0]!.alpha).toBeCloseTo(0.5, 9);
    flashes.update(DAMAGE_FLASH_SECONDS / 2 + 0.001);
    expect(flashes.active).toHaveLength(0);
  });
});
