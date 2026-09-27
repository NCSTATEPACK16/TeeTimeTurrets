import { beforeEach, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { BallPool, LANDED_BALL_DESPAWN_S, MAX_FLIGHT_S, POOL_SIZE } from "./BallPool";
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

  /** Every body in flight, fired 0.1 s apart, all high in the air except `grounded` on the turf. */
  function fillPoolInFlight(grounded: readonly number[]): ReturnType<BallPool["acquire"]>[] {
    const balls = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      pool.step(DT, i * 0.1);
      const ball = pool.acquire(0);
      // Into the air at once: left at the parked position, a ball reads as resting on the ground
      // and the pool would call it landed before the fill is done.
      ball!.body.setTranslation({ x: i, y: 50, z: 0 }, true);
      balls.push(ball);
    }
    for (const i of grounded) balls[i]!.body.setTranslation({ x: i, y: 0.03, z: 0 }, true);
    // One step, so the pool has looked at where each ball is.
    pool.step(DT, POOL_SIZE * 0.1);
    return balls;
  }

  it("with every body in flight, recycles the oldest ball already on the ground", () => {
    // A 4v4 on the putter keeps all 32 balls in flight most of the time, mostly rolling out a shot
    // on the turf. Refusing the next shot then is a trigger that silently does nothing. Ball 0 is
    // the oldest of all but still in the air, so it is passed over. Of the two on the ground, 9 is
    // made the older, so "the first one found" and "the oldest" give different answers.
    const balls = fillPoolInFlight([5, 9]);
    balls[9]!.firedAt = 0.05;
    const recycled = pool.acquire(1);
    expect(recycled?.body).toBe(balls[9]!.body);
    expect(recycled!.firedBy).toBe(1);
    expect(recycled!.state).toBe("flying");
  });

  it("with every body in the air, still refuses rather than take a ball out of its arc", () => {
    fillPoolInFlight([]);
    expect(pool.acquire(1)).toBeNull();
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
    const injectedPool = new BallPool(world, { heightAt: () => injectedGroundY });

    const ball = injectedPool.acquire(0)!;
    ball.body.setTranslation({ x: 0, y: injectedGroundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) injectedPool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    injectedPool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
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
      pool.step(DT, time);
    }
    expect(ball.state).toBe("flying");
    while (time < MAX_FLIGHT_S + 0.5) {
      time += DT;
      pool.step(DT, time);
    }
    expect(ball.state).toBe("idle");
  });
});
