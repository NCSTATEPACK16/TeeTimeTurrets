import { describe, expect, it } from "vitest";
import { BASE_FOV_DEG } from "./cameraTrauma";
import {
  CHASE_DISTANCE,
  CHASE_MIN_GROUND_CLEARANCE,
  CHASE_POSITION_LERP,
  CHASE_SIDE,
  chasePose,
  chaseSmoothing,
  fitChaseToGround,
} from "./chaseCamera";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { CART_COLLIDER } from "../sim/entities/Cart";
import type { CartTransform } from "../sim/world";

function cartAt(heading: number, turretYaw: number): CartTransform {
  return { position: { x: 0, y: 0, z: 0 }, heading, turretYaw };
}

describe("chase camera", () => {
  it("sits behind the turret, not the chassis, so the player sees what they are aiming at", () => {
    // Chassis facing +X, turret swung round to +Z.
    const eye = { x: 0, y: 0, z: 0 };
    const look = { x: 0, y: 0, z: 0 };
    chasePose(cartAt(0, Math.PI / 2), eye, look);
    // Behind the turret, and off to its right: with the turret facing +z, its right is -x.
    expect(eye.x).toBeCloseTo(-CHASE_SIDE, 9);
    expect(eye.z).toBeCloseTo(-CHASE_DISTANCE, 9);
    expect(look.z).toBeGreaterThan(0);
  });

  it("closes the same distance in two half-length frames as in one full frame", () => {
    // Per-frame lerp factors make a 144 Hz monitor's camera three times as stiff as a 48 Hz one.
    const oneFrame = chaseSmoothing(CHASE_POSITION_LERP, 1 / 60);
    const half = chaseSmoothing(CHASE_POSITION_LERP, 1 / 120);
    const twoHalves = 1 - (1 - half) * (1 - half);
    expect(twoHalves).toBeCloseTo(oneFrame, 9);
  });

  it("keeps the 60 Hz feel it was tuned at", () => {
    expect(chaseSmoothing(CHASE_POSITION_LERP, 1 / 60)).toBeCloseTo(CHASE_POSITION_LERP, 9);
  });

  it("does not move at all in a zero-length frame", () => {
    expect(chaseSmoothing(CHASE_POSITION_LERP, 0)).toBe(0);
  });

  it("puts the horizon about a fifth of the way down the frame on level ground", () => {
    const eye = { x: 0, y: 0, z: 0 };
    const look = { x: 0, y: 0, z: 0 };
    chasePose(cartAt(0, 0), eye, look);
    const pitch = Math.atan2(eye.y - look.y, Math.hypot(look.x - eye.x, look.z - eye.z));
    // The horizon is `pitch` above the view's centre; as a fraction of the frame from the top.
    const halfFov = (BASE_FOV_DEG * Math.PI) / 360;
    const fromTop = (1 - Math.tan(pitch) / Math.tan(halfFov)) / 2;
    expect(fromTop).toBeGreaterThan(0.17);
    expect(fromTop).toBeLessThan(0.23);
  });

  it("never lets the shipped course's ground clip the eye or the sight line to the cart", () => {
    const world = buildCourseWorld(authoredCourse(2026), 2026);
    const heightAt = (x: number, z: number): number => world.terrain.heightAt(x, z);
    const eye = { x: 0, y: 0, z: 0 };
    const look = { x: 0, y: 0, z: 0 };
    /** Lowest the line from the cart's roof to the eye comes to the ground, sampled finer than the fit. */
    const sightClearance = (x: number, y: number, z: number, at: { x: number; y: number; z: number }): number => {
      let lowest = Infinity;
      for (let i = 1; i <= 20; i++) {
        const f = i / 21;
        const lineY = y + 1.2 + (at.y - y - 1.2) * f;
        lowest = Math.min(lowest, lineY - heightAt(x + (at.x - x) * f, z + (at.z - z) * f));
      }
      return lowest;
    };
    let poses = 0;
    let worstLevel = Infinity;
    let worstLine = Infinity;
    let worstEye = Infinity;
    // A 60 m grid over the whole course, rough and hills included, four ways at each point.
    const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
    for (let x = minX + 30; x < maxX; x += 60) {
      for (let z = minZ + 30; z < maxZ; z += 60) {
        const y = heightAt(x, z) + CART_COLLIDER.groundOffset;
        for (let k = 0; k < 4; k++) {
          const yaw = (k * Math.PI) / 2;
          chasePose({ position: { x, y, z }, heading: yaw, turretYaw: yaw }, eye, look);
          worstLevel = Math.min(worstLevel, sightClearance(x, y, z, eye));
          fitChaseToGround(x, y, z, yaw, heightAt, eye, look);
          worstLine = Math.min(worstLine, sightClearance(x, y, z, eye));
          poses++;
          worstEye = Math.min(worstEye, eye.y - heightAt(eye.x, eye.z));
        }
      }
    }
    expect(poses).toBeGreaterThan(2000);
    // The premise: somewhere on the course the level-ground pose does clip, so the fit is tested.
    expect(worstLevel).toBeLessThan(0);
    expect(worstEye).toBeGreaterThanOrEqual(CHASE_MIN_GROUND_CLEARANCE - 1e-9);
    expect(worstLine).toBeGreaterThan(0);
  });

  it("lifts over a bank behind the cart, and pulls in when the bank is too tall to lift over", () => {
    // Facing +x on flat ground at y = 0, with a wall of ground 2-4 m behind the cart.
    const bank = (height: number) => (x: number): number => (x > -4 && x < -2 ? height : 0);
    const y = CART_COLLIDER.groundOffset;
    const clearOf = (heightAt: (x: number) => number, eye: { x: number; y: number }): number => {
      let lowest = Infinity;
      for (let i = 1; i <= 50; i++) {
        const f = i / 51;
        lowest = Math.min(lowest, y + 1.2 + (eye.y - y - 1.2) * f - heightAt(eye.x * f));
      }
      return lowest;
    };
    for (const height of [2.5, 7]) {
      const eye = { x: 0, y: 0, z: 0 };
      const look = { x: 0, y: 0, z: 0 };
      chasePose(cartAt(0, 0), eye, look);
      expect(clearOf(bank(height), eye)).toBeLessThan(0); // the premise: level framing is blocked
      fitChaseToGround(0, y, 0, 0, bank(height), eye, look);
      expect(clearOf(bank(height), eye)).toBeGreaterThan(0);
      // A low bank is lifted over from where the camera was; a tall one is pulled inside.
      if (height === 2.5) expect(eye.x).toBeCloseTo(-CHASE_DISTANCE, 9);
      else expect(eye.x).toBeGreaterThan(-2);
    }
  });
});
