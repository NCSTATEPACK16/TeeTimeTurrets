import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_PART_ANGVEL, MAX_PART_LINVEL, Target } from "./Target";

/**
 * Phase 3's ragdoll gate, run headlessly against a real Rapier world. The pass conditions are
 * the ones docs/DECISIONS.md "Ragdolls" fixes in advance -- holds its pose with no drift,
 * collapses when struck, no self-collision buzz -- asserted rather than eyeballed.
 */

const DT = 1 / 60;
const BALL_RADIUS = 0.15;
const BALL_DENSITY = 1130;

function stepWorld(world: RAPIER.World, target: Target, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.step();
    target.step();
  }
}

function totalSpeed(target: Target): number {
  let total = 0;
  for (const part of target.parts) {
    const v = part.body.linvel();
    total += Math.hypot(v.x, v.y, v.z);
  }
  return total;
}

describe("Target ragdoll", () => {
  let world: RAPIER.World;
  let target: Target;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
    target = new Target(world, { x: 0, y: 0, z: 0 });
  });

  it("holds its pose while undisturbed -- body type, not joints", () => {
    const head = target.part("head");
    const before = { ...head.body.translation() };
    stepWorld(world, target, 300); // 5 s, DECISIONS.md's settle window
    const after = head.body.translation();

    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-9);
    expect(target.isDown).toBe(false);
    for (const part of target.parts) expect(part.body.isFixed()).toBe(true);
  });

  it("flips the whole rig to dynamic and collapses when struck", () => {
    const headY = target.part("head").body.translation().y;
    target.knockDown(target.part("torso"), { x: 60, y: 0, z: 0 });

    expect(target.isDown).toBe(true);
    for (const part of target.parts) expect(part.body.isDynamic()).toBe(true);

    stepWorld(world, target, 180); // 3 s
    expect(target.part("head").body.translation().y).toBeLessThan(headY - 0.3);
  });

  it("clamps post-impact velocity so a hit cannot launch the rig", () => {
    target.knockDown(target.part("torso"), { x: 100000, y: 0, z: 0 });

    for (const part of target.parts) {
      const v = part.body.linvel();
      const w = part.body.angvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(MAX_PART_LINVEL + 1e-6);
      expect(Math.hypot(w.x, w.y, w.z)).toBeLessThanOrEqual(MAX_PART_ANGVEL + 1e-6);
    }
  });

  it("keeps clamping while it falls, so the collapse cannot accelerate away", () => {
    target.knockDown(target.part("torso"), { x: 100000, y: 400, z: 0 });
    stepWorld(world, target, 120);

    for (const part of target.parts) {
      const v = part.body.linvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(MAX_PART_LINVEL + 1e-6);
    }
  });

  it("does not buzz: adjacent capsules never collide with each other", () => {
    // Self-collision is disabled via collision groups, so a knocked-down rig settles instead of
    // vibrating forever -- the failure DECISIONS.md names as the usual ragdoll bug.
    target.knockDown(target.part("torso"), { x: 30, y: 0, z: 0 });
    stepWorld(world, target, 600); // 10 s
    expect(totalSpeed(target)).toBeLessThan(0.5);
  });

  it("resets back to the held pose", () => {
    const head = target.part("head");
    const posed = { ...head.body.translation() };
    target.knockDown(target.part("torso"), { x: 60, y: 0, z: 0 });
    stepWorld(world, target, 120);
    target.reset();

    expect(target.isDown).toBe(false);
    for (const part of target.parts) expect(part.body.isFixed()).toBe(true);

    const back = head.body.translation();
    expect(back.x).toBeCloseTo(posed.x, 6);
    expect(back.y).toBeCloseTo(posed.y, 6);
    expect(back.z).toBeCloseTo(posed.z, 6);
  });

  it("builds 7-11 capsules, none of them CCD-enabled", () => {
    expect(target.parts.length).toBeGreaterThanOrEqual(7);
    expect(target.parts.length).toBeLessThanOrEqual(11);
    for (const part of target.parts) expect(part.body.isCcdEnabled()).toBe(false);
  });

  it("keeps the ball-to-heaviest-part mass ratio inside the 1:20 criterion", () => {
    // DECISIONS.md "Ball mass" fixes the criterion; this asserts it against the real bodies
    // rather than against the 46 g figure that entry assumes. BALL_RADIUS is 0.15 m in this
    // project, so the ball is ~16 kg and the ratio is already well inside the bound -- see
    // docs/superpowers/plans/2026-09-02-targets-health-combat-implementation.md.
    const ballMass = (4 / 3) * Math.PI * BALL_RADIUS ** 3 * BALL_DENSITY;
    target.knockDown(target.part("torso"), { x: 0, y: 0, z: 0 }); // dynamic bodies report mass
    let heaviest = 0;
    for (const part of target.parts) heaviest = Math.max(heaviest, part.body.mass());

    expect(heaviest).toBeGreaterThan(0);
    expect(ballMass).toBeGreaterThanOrEqual(heaviest / 20);
  });

  it("disposes every body it created", () => {
    const before = world.bodies.len();
    const extra = new Target(world, { x: 5, y: 0, z: 0 });
    expect(world.bodies.len()).toBeGreaterThan(before);
    extra.dispose();
    expect(world.bodies.len()).toBe(before);
  });
});
