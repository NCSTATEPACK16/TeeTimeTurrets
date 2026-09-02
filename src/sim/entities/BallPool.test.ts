import { beforeEach, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { heightAt } from "../terrain";
import { BallPool, LANDED_BALL_DESPAWN_S, POOL_SIZE } from "./BallPool";

const DT = 1 / 60;

describe("BallPool", () => {
  let world: RAPIER.World;
  let pool: BallPool;

  beforeEach(async () => {
    await RAPIER.init();
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    pool = new BallPool(world);
  });

  it("acquire returns a distinct idle body each call up to POOL_SIZE", () => {
    const seen = new Set<RAPIER.RigidBody>();
    for (let i = 0; i < POOL_SIZE; i++) {
      const ball = pool.acquire();
      expect(ball).not.toBeNull();
      expect(seen.has(ball!.body)).toBe(false);
      seen.add(ball!.body);
      expect(ball!.state).toBe("flying");
    }
  });

  it("the (POOL_SIZE + 1)th acquire recycles the oldest landed body, never a flying one", () => {
    const first = pool.acquire()!;
    first.state = "landed";
    first.landedAt = 0;
    for (let i = 1; i < POOL_SIZE; i++) pool.acquire();

    const recycled = pool.acquire();
    expect(recycled).not.toBeNull();
    expect(recycled!.body).toBe(first.body);
    expect(recycled!.state).toBe("flying");
  });

  it("acquire returns null when every body is flying (never recycles a flying ball)", () => {
    for (let i = 0; i < POOL_SIZE; i++) pool.acquire();
    expect(pool.acquire()).toBeNull();
  });

  it("release() returns a body to idle", () => {
    const ball = pool.acquire()!;
    pool.release(ball);
    expect(ball.state).toBe("idle");
  });

  it("step() transitions flying -> landed after sustained rest on the ground", () => {
    const ball = pool.acquire()!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    pool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });

  it("step() does not land a ball that is still moving fast", () => {
    const ball = pool.acquire()!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 5, y: 0, z: 0 }, true);

    for (let i = 0; i < 20; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");
  });

  it("step() transitions landed -> idle after exactly LANDED_BALL_DESPAWN_S, not before", () => {
    const ball = pool.acquire()!;
    ball.state = "landed";
    ball.landedAt = 0;

    pool.step(DT, LANDED_BALL_DESPAWN_S - 0.001);
    expect(ball.state).toBe("landed");

    pool.step(DT, LANDED_BALL_DESPAWN_S);
    expect(ball.state).toBe("idle");
  });

  it("ballsNear returns only landed balls within range", () => {
    const landed = pool.acquire()!;
    landed.state = "landed";
    landed.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const flying = pool.acquire()!;
    flying.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const near = pool.ballsNear(5, 5, 1);
    expect(near).toHaveLength(1);
    expect(near[0].body).toBe(landed.body);
    expect(pool.ballsNear(50, 50, 1)).toHaveLength(0);
  });
});
