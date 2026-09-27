import { describe, expect, it } from "vitest";
import {
  BASE_FOV_DEG,
  CameraTrauma,
  MAX_FOV_KICK_DEG,
  MAX_SHAKE_M,
  TRAUMA_DECAY_PER_S,
  fovForSpeed,
} from "./cameraTrauma";

describe("CameraTrauma", () => {
  it("adds up to a cap of 1", () => {
    const t = new CameraTrauma();
    t.add(0.6);
    t.add(0.6);
    expect(t.value).toBe(1);
  });

  it(`decays at ${TRAUMA_DECAY_PER_S}/s to rest`, () => {
    const t = new CameraTrauma();
    t.add(1);
    t.update(0.5 / TRAUMA_DECAY_PER_S);
    expect(t.value).toBeCloseTo(0.5);
    t.update(1 / TRAUMA_DECAY_PER_S);
    expect(t.value).toBe(0);
  });

  it("shakes with the square of trauma, so small knocks stay small", () => {
    const t = new CameraTrauma();
    t.add(0.5);
    expect(t.shake).toBeCloseTo(0.25);
  });

  it("holds perfectly still at zero trauma", () => {
    const t = new CameraTrauma();
    const out = { x: 1, y: 1, roll: 1 };
    t.update(0.3);
    t.offset(out);
    expect(out).toEqual({ x: 0, y: 0, roll: 0 });
  });

  it("never throws the camera further than the shake allows", () => {
    const t = new CameraTrauma();
    t.add(1);
    const out = { x: 0, y: 0, roll: 0 };
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      t.update(1 / 240); // barely decays
      t.offset(out);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(MAX_SHAKE_M * t.shake + 1e-9);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(MAX_SHAKE_M * t.shake + 1e-9);
      moved = Math.max(moved, Math.abs(out.x));
    }
    expect(moved, "a full-trauma shake that never moves is no shake").toBeGreaterThan(MAX_SHAKE_M * 0.3);
  });
});

describe("fovForSpeed", () => {
  it("sits at the base field of view when stopped, and widens with speed up to the kick", () => {
    expect(fovForSpeed(0)).toBe(BASE_FOV_DEG);
    expect(fovForSpeed(0.5)).toBeGreaterThan(BASE_FOV_DEG);
    expect(fovForSpeed(1)).toBeCloseTo(BASE_FOV_DEG + MAX_FOV_KICK_DEG);
    expect(fovForSpeed(3)).toBeCloseTo(BASE_FOV_DEG + MAX_FOV_KICK_DEG); // clamped
    expect(fovForSpeed(-1)).toBe(BASE_FOV_DEG); // reversing does not narrow it
  });
});
