import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { lightBasis, snapFocus } from "./shadows";
import { PARKLAND_SKY, sunDirection } from "./sky";

/** Med's map moves only in whole texels: what keeps a cart's shadow from shimmering as it drives. */
describe("the single shadow map's snapped focus", () => {
  const sun = sunDirection(PARKLAND_SKY);
  const basis = lightBasis(sun);
  const texel = 0.05;
  const snapped = (p: THREE.Vector3): THREE.Vector3 => snapFocus(p, basis, sun, texel, new THREE.Vector3());

  it("holds still while the camera moves less than a texel across the light", () => {
    // A tenth of a texel past a corner, then three tenths further: still inside the same texel.
    const start = snapped(new THREE.Vector3(10, 2, -4)).addScaledVector(basis.right, texel * 0.1);
    const a = snapped(start);
    const b = snapped(start.clone().addScaledVector(basis.right, texel * 0.3));
    expect(b.distanceTo(a)).toBe(0);
  });

  it("steps exactly one texel when the camera crosses one", () => {
    const start = new THREE.Vector3(3, 1, 7);
    const a = snapped(start);
    const b = snapped(start.clone().addScaledVector(basis.right, texel));
    expect(b.clone().sub(a).dot(basis.right)).toBeCloseTo(texel, 9);
    expect(b.clone().sub(a).dot(basis.up)).toBeCloseTo(0, 9);
  });
});
