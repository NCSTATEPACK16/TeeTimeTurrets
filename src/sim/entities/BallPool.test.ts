import { beforeEach, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { BallPool, LANDED_BALL_DESPAWN_S, MAX_FLIGHT_S, POOL_SIZE } from "./BallPool";
import type { PooledBall } from "./BallPool";
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
    pool = new BallPool(world, { heightAt });
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

    for (let i = 0; i < 11; i++) {
      pool.sync();
      pool.step(DT, i * DT);
    }
    expect(ball.state).toBe("flying");

    pool.sync();
    pool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });

  it("step() does not land a ball that is still moving fast", () => {
    const ball = pool.acquire(0)!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 5, y: 0, z: 0 }, true);

    for (let i = 0; i < 20; i++) {
      pool.sync();
      pool.step(DT, i * DT);
    }
    expect(ball.state).toBe("flying");
  });

  it("step() transitions landed -> idle after exactly LANDED_BALL_DESPAWN_S, not before", () => {
    const ball = pool.acquire(0)!;
    ball.state = "landed";
    ball.landedAt = 0;

    pool.sync();
    pool.step(DT, LANDED_BALL_DESPAWN_S - 0.001);
    expect(ball.state).toBe("landed");

    pool.sync();
    pool.step(DT, LANDED_BALL_DESPAWN_S);
    expect(ball.state).toBe("idle");
  });

  it("ballsNear returns only landed balls within range", () => {
    const landed = pool.acquire(0)!;
    landed.state = "landed";
    landed.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const flying = pool.acquire(0)!;
    flying.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    pool.sync();
    const near: PooledBall[] = [];
    expect(pool.ballsNear(5, 5, 1, near)).toBe(1);
    expect(near[0]!.body).toBe(landed.body);
    expect(pool.ballsNear(50, 50, 1, near)).toBe(0);
  });

  it("step() grounds a ball against the injected height function, not any real terrain", () => {
    // A constant height far above real terrain (real heightAt(0,0) is within a few meters of 0).
    // If BallPool ever silently reverted to importing a module-level heightAt instead of using
    // the constructor-injected one, this ball would never satisfy the grounded check at this
    // height and the test would fail.
    const injectedGroundY = 500;
    const injectedPool = new BallPool(world, { heightAt: () => injectedGroundY });

    const ball = injectedPool.acquire(0)!;
    ball.body.setTranslation({ x: 0, y: injectedGroundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) injectedPool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    injectedPool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });

  /** Every body in flight, each held 50 m up so none counts as touched down, fired a tick apart. */
  function fillInFlight(owners: (i: number) => number): { balls: ReturnType<BallPool["acquire"]>[]; time: number } {
    const balls: ReturnType<BallPool["acquire"]>[] = [];
    let time = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const ball = pool.acquire(owners(i))!;
      ball.body.setTranslation({ x: i, y: 50, z: 0 }, true);
      balls.push(ball);
      time += DT;
      pool.sync();
      pool.step(DT, time);
    }
    return { balls, time };
  }

  it("recycles a ball that has come down and is only rolling, before refusing anyone", () => {
    const { balls, time } = fillInFlight(() => 1);
    const roller = balls[7]!;
    // On the grass and still moving: not at rest, so not landed, but no longer a shot in the air.
    roller.body.setTranslation({ x: 0, y: 0.1, z: 0 }, true);
    roller.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
    pool.sync();
    pool.step(DT, time + DT);
    expect(roller.state).toBe("flying");

    const next = pool.acquire(2);
    expect(next).not.toBeNull();
    expect(next!.body).toBe(roller.body);
  });

  it("gives the player the oldest bot ball still in the air rather than refusing the shot", () => {
    const { balls } = fillInFlight((i) => 1 + (i % 7)); // seven bots' balls
    expect(pool.acquire(3), "a bot is still refused when every ball is airborne").toBeNull();

    const taken = pool.acquire(0, true);
    expect(taken).not.toBeNull();
    expect(taken!.body).toBe(balls[0]!.body); // fired first
    expect(taken!.firedBy).toBe(0);
    expect(taken!.spent).toBe(false);
  });

  it("never hands the player back one of their own shots still in the air", () => {
    fillInFlight((i) => (i === 31 ? 1 : 0)); // all the player's but the newest
    const taken = pool.acquire(0, true);
    expect(taken).not.toBeNull();
    expect(pool.all.filter((b) => b.state === "flying" && b.firedBy === 0)).toHaveLength(POOL_SIZE);

    pool.releaseAll();
    fillInFlight(() => 0);
    expect(pool.acquire(0, true)).toBeNull();
  });
});

describe("BallPool rolling and flight limits", () => {
  it("drags a ball rolling on turf to a stop, where damping alone leaves it creeping", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // A long gentle slope, as a flat plane collider tilted about Z: the case damping cannot stop.
    const tilt = 0.08;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
        .setTranslation(0, -0.5, 0)
        .setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) }),
    );
    const heightAt = (x: number) => Math.tan(tilt) * x;
    const tuningAt = (_x: number, _z: number, out: { rolling: number; bounceScale: number }) => {
      out.rolling = 0.12;
      out.bounceScale = 0.8;
    };
    const pool = new BallPool(world, { heightAt, tuningAt });
    const ball = pool.acquire(0)!;
    // Downhill (-x). Rolled uphill instead, the ball passes through zero speed at the top of its
    // climb and the rest detector reads that apex as a stop -- a test that passes with no drag at all.
    ball.body.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
    ball.body.setLinvel({ x: -3, y: 0, z: 0 }, true);

    let time = 0;
    for (let i = 0; i < 10 * 60; i++) {
      world.step();
      time += DT;
      pool.sync();
      pool.step(DT, time);
    }
    expect(ball.state).toBe("landed");
  });

  it("gives back a ball that is still flying after MAX_FLIGHT_S", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // no gravity: it never comes down
    const pool = new BallPool(world, { heightAt: () => -100 });
    const ball = pool.acquire(0)!;
    ball.body.setTranslation({ x: 0, y: 0, z: 0 }, true); // far above the ground, and staying there
    let time = 0;
    while (time < MAX_FLIGHT_S - 0.5) {
      time += DT;
      pool.sync();
      pool.step(DT, time);
    }
    expect(ball.state).toBe("flying");
    while (time < MAX_FLIGHT_S + 0.5) {
      time += DT;
      pool.sync();
      pool.step(DT, time);
    }
    expect(ball.state).toBe("idle");
  });

});
