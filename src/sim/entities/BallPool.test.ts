import { beforeEach, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { BallPool, LANDED_BALL_DESPAWN_S, POOL_SIZE } from "./BallPool";
import { NO_KILLER } from "../matchConfig";

const DT = 1 / 60;

/** BallPool takes its height function injected -- these tests supply a flat one rather than
 * depending on any particular terrain, per the leaf-module design. */
const heightAt = (_x: number, _z: number) => 0;

describe("BallPool", () => {
  let world: RAPIER.World;
  let pool: BallPool;

  beforeEach(async () => {
    await RAPIER.init();
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    pool = new BallPool(world, heightAt);
  });

  it("acquire returns a distinct idle body each call up to POOL_SIZE", () => {
    const seen = new Set<RAPIER.RigidBody>();
    for (let i = 0; i < POOL_SIZE; i++) {
      const ball = pool.acquire(0);
      expect(ball).not.toBeNull();
      expect(seen.has(ball!.body)).toBe(false);
      seen.add(ball!.body);
      expect(ball!.state).toBe("flying");
    }
  });

  it("the (POOL_SIZE + 1)th acquire recycles the oldest landed body, never a flying one", () => {
    const first = pool.acquire(0)!;
    first.state = "landed";
    first.landedAt = 0;
    for (let i = 1; i < POOL_SIZE; i++) pool.acquire(0);

    const recycled = pool.acquire(0);
    expect(recycled).not.toBeNull();
    expect(recycled!.body).toBe(first.body);
    expect(recycled!.state).toBe("flying");
  });

  it("acquire returns null when every body is flying (never recycles a flying ball)", () => {
    for (let i = 0; i < POOL_SIZE; i++) pool.acquire(0);
    expect(pool.acquire(0)).toBeNull();
  });

  it("a recycled body carries its new shooter, not the one who last fired it", () => {
    // The whole point of `firedBy`: arena scores a kill against whoever fired the ball, and a
    // pool of 32 bodies recycles. Asserted on the recycle path rather than on a fresh body,
    // because a fresh body reports the right owner even if nothing ever clears the old one.
    const first = pool.acquire(3)!;
    expect(first.firedBy).toBe(3);
    first.state = "landed";
    first.landedAt = 0;
    for (let i = 1; i < POOL_SIZE; i++) pool.acquire(3);

    const recycled = pool.acquire(1)!;
    expect(recycled.body).toBe(first.body);
    expect(recycled.firedBy).toBe(1);
  });

  it("a released body owns nothing", () => {
    // A landed ball is picked up for ammo and released. Until it is fired again it belongs to
    // nobody, and a stale owner on an idle body is a kill waiting to be credited to the wrong
    // cart the moment something reads it out of turn.
    const ball = pool.acquire(2)!;
    pool.release(ball);
    expect(ball.firedBy).toBe(NO_KILLER);
  });

  it("release() returns a body to idle", () => {
    const ball = pool.acquire(0)!;
    pool.release(ball);
    expect(ball.state).toBe("idle");
  });

  it("step() transitions flying -> landed after sustained rest on the ground", () => {
    const ball = pool.acquire(0)!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    pool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });

  it("step() does not land a ball that is still moving fast", () => {
    const ball = pool.acquire(0)!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 5, y: 0, z: 0 }, true);

    for (let i = 0; i < 20; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");
  });

  it("step() transitions landed -> idle after exactly LANDED_BALL_DESPAWN_S, not before", () => {
    const ball = pool.acquire(0)!;
    ball.state = "landed";
    ball.landedAt = 0;

    pool.step(DT, LANDED_BALL_DESPAWN_S - 0.001);
    expect(ball.state).toBe("landed");

    pool.step(DT, LANDED_BALL_DESPAWN_S);
    expect(ball.state).toBe("idle");
  });

  it("ballsNear returns only landed balls within range", () => {
    const landed = pool.acquire(0)!;
    landed.state = "landed";
    landed.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const flying = pool.acquire(0)!;
    flying.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const near = pool.ballsNear(5, 5, 1);
    expect(near).toHaveLength(1);
    expect(near[0].body).toBe(landed.body);
    expect(pool.ballsNear(50, 50, 1)).toHaveLength(0);
  });

  it("step() grounds a ball against the injected height function, not any real terrain", () => {
    // A constant height far above real terrain (real heightAt(0,0) is within a few meters of 0).
    // If BallPool ever silently reverted to importing a module-level heightAt instead of using
    // the constructor-injected one, this ball would never satisfy the grounded check at this
    // height and the test would fail.
    const injectedGroundY = 500;
    const injectedPool = new BallPool(world, () => injectedGroundY);

    const ball = injectedPool.acquire(0)!;
    ball.body.setTranslation({ x: 0, y: injectedGroundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) injectedPool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    injectedPool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });
});
