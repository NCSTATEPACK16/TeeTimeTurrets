import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SKY, envProbeValid, fogDensityFor, skyColourAt, sunDirection } from "./sky";
import type { SkyStyle } from "./sky";

/**
 * The sky's model, in TypeScript. The dome's shader mirrors `skyColourAt`, and the browser reads
 * the dome's horizon back for the fog colour; the smoke check holds the readback to this model, so
 * a shader that drifts from it shows up there. What is checked here is the model's own shape.
 */

const NO_SUN: SkyStyle = { ...SKY, sunGlow: 0, sunDiscIntensity: 0 };

function linear(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

function colourAt(style: SkyStyle, x: number, y: number, z: number): THREE.Color {
  const out = new THREE.Color();
  const n = Math.hypot(x, y, z);
  skyColourAt(style, x / n, y / n, z / n, out);
  return out;
}

function expectColour(got: THREE.Color, want: THREE.Color, digits = 5): void {
  expect(got.r).toBeCloseTo(want.r, digits);
  expect(got.g).toBeCloseTo(want.g, digits);
  expect(got.b).toBeCloseTo(want.b, digits);
}

describe("sunDirection", () => {
  it("is a unit vector at the style's elevation, with azimuth 0 down +X and 90 down +Z", () => {
    const east = sunDirection({ ...SKY, sunElevationDeg: 0, sunAzimuthDeg: 0 });
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.y).toBeCloseTo(0, 9);
    const south = sunDirection({ ...SKY, sunElevationDeg: 0, sunAzimuthDeg: 90 });
    expect(south.z).toBeCloseTo(1, 9);
    const sun = sunDirection(SKY);
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 9);
    expect(Math.asin(sun.y)).toBeCloseTo((SKY.sunElevationDeg * Math.PI) / 180, 9);
  });
});

describe("skyColourAt", () => {
  it("is the zenith colour straight up and the horizon colour level", () => {
    expectColour(colourAt(NO_SUN, 0, 1, 0), linear(SKY.zenith));
    expectColour(colourAt(NO_SUN, 1, 0, 0), linear(SKY.horizon));
    expectColour(colourAt(NO_SUN, -0.3, 0, 0.8), linear(SKY.horizon));
  });

  it("is the ground colour looking down, so the environment's lower half lights from below", () => {
    expectColour(colourAt(NO_SUN, 0, -1, 0), linear(SKY.ground));
  });

  it("climbs from horizon to zenith monotonically", () => {
    let last = colourAt(NO_SUN, 1, 0, 0).b - linear(SKY.horizon).b;
    for (let deg = 5; deg <= 90; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const c = colourAt(NO_SUN, Math.cos(rad), Math.sin(rad), 0);
      // Distance from the horizon colour grows with elevation.
      const away = Math.hypot(c.r - linear(SKY.horizon).r, c.g - linear(SKY.horizon).g, c.b - linear(SKY.horizon).b);
      expect(away, `${deg} deg`).toBeGreaterThanOrEqual(last);
      last = away;
    }
    // And gets somewhere: a sky that is one colour all the way up also never decreases.
    expect(last).toBeGreaterThan(0.1);
  });

  it("is brighter toward the sun than away from it, and leaves the anti-sun horizon alone", () => {
    const sun = sunDirection(SKY);
    const toward = colourAt(SKY, sun.x, 0.05, sun.z);
    const away = colourAt(SKY, -sun.x, 0.05, -sun.z);
    expect(toward.r + toward.g + toward.b).toBeGreaterThan(away.r + away.g + away.b);
    // The fog is read from the horizon facing away from the sun, and there the sky is the bare
    // horizon colour: the sun adds nothing on the far side of the sky.
    expectColour(colourAt(SKY, -sun.x, 0, -sun.z), linear(SKY.horizon));
  });

  it("draws the sun's disc where the sun is", () => {
    const sun = sunDirection(SKY);
    const disc = colourAt(SKY, sun.x, sun.y, sun.z);
    const beside = colourAt(SKY, sun.x + 0.2, sun.y, sun.z);
    expect(disc.r).toBeGreaterThan(beside.r + 0.5);
  });
});

describe("fogDensityFor", () => {
  it("puts the given share of fog at the given distance", () => {
    const d = fogDensityFor(1200, 0.95);
    // FogExp2: factor = 1 - exp(-(density * distance)^2).
    expect(1 - Math.exp(-((d * 1200) ** 2))).toBeCloseTo(0.95, 9);
    expect(fogDensityFor(600, 0.95)).toBeCloseTo(2 * d, 9);
  });
});

describe("envProbeValid", () => {
  it("accepts a lit probe and rejects a black one, which is what NaN texels render as", () => {
    const lit = new Uint8Array(8 * 4).fill(120);
    const black = new Uint8Array(8 * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    expect(envProbeValid(lit)).toBe(true);
    expect(envProbeValid(black)).toBe(false);
    expect(envProbeValid(new Uint8Array(0))).toBe(false);
  });
});
