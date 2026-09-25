import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Cart } from "./entities/Cart";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import {
  CombatRegistry,
  SHUNT_DAMAGE_PER_MPS,
  SHUNT_MIN_SPEED,
  STROKE_DAMAGE,
  processContacts,
} from "./combat";
import type { CollisionEventSource } from "./combat";
import type { PooledBall } from "./entities/BallPool";
import { createStats } from "./stats";
import type { Stats } from "./stats";

/**
 * Dispatch is tested against a fake queue exposing only `drainCollisionEvents` -- the whole
 * surface `processContacts` uses -- so the contact cases can be scripted exactly instead of
 * being staged in a physics world and hoped for. The entities either side of a contact
 * (`Cart`, ball bodies) are the real ones.
 */

type Event = [number, number, boolean];

function queueOf(...events: Event[]): CollisionEventSource {
  return {
    drainCollisionEvents(f) {
      for (const [h1, h2, started] of events) f(h1, h2, started);
    },
  };
}

describe("combat contact resolution", () => {
  let world: RAPIER.World;
  let registry: CombatRegistry;
  let stats: Stats;
  let cart: Cart;
  let cartHandle: number;
  let ball: PooledBall;
  let ballHandle: number;
  let killed: Cart[];
  /** Every `onCartKilled` call, so a test can assert who was credited and not merely that
   *  somebody died. `killed` stays as the cart list the older tests read. */
  let kills: { victim: number; killer: number }[];
  /** Every `onBallHit` shooter, in order. */
  let hits: number[];
  /** Every `onBallHit` impact position, in order -- where a hit marker would float. */
  let hitPositions: { x: number; y: number; z: number }[];

  beforeAll(async () => {
    await RAPIER.init();
  });

  function ctx() {
    return {
      registry,
      stats,
      // `Sim.creditHit` is what decides whose accuracy a hit belongs to; here the raw shooter is
      // recorded and `stats.directHits` is credited unconditionally, so the existing tests that
      // assert on `directHits` keep asserting what they always did.
      onBallHit: (shooter: number, x: number, y: number, z: number) => {
        hits.push(shooter);
        hitPositions.push({ x, y, z });
        stats.directHits += 1;
      },
      onCartKilled: (c: Cart, victim: number, killer: number) => {
        killed.push(c);
        kills.push({ victim, killer });
      },
    };
  }

  /** A pooled ball, shaped as `BallPool` builds them. `firedBy` defaults to rig 0 -- the player --
   *  because that is what every pre-Stage-C test implicitly assumed. */
  function makeBall(vx: number, firedBy = 0): { ball: PooledBall; handle: number } {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(0.15).setDensity(1130), body);
    body.setLinvel({ x: vx, y: 0, z: 0 }, true);
    return { ball: { body, state: "flying", landedAt: 0, firedBy, firedAt: 0 }, handle: collider.handle };
  }

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    registry = new CombatRegistry();
    stats = createStats();
    killed = [];
    kills = [];
    hits = [];
    hitPositions = [];

    cart = new Cart({ position: { x: 0, y: 0, z: 0 } });
    const cartBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    cartHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), cartBody).handle;
    registry.registerCart(cartHandle, cart, 0);

    const made = makeBall(30);
    ball = made.ball;
    ballHandle = made.handle;
    registry.registerBall(ballHandle, ball);
  });

  it("a ball hitting a cart costs one point of health and counts a direct hit", () => {
    processContacts(queueOf([ballHandle, cartHandle, true]), ctx());

    expect(stats.directHits).toBe(1);
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);
  });

  it("reports where the ball was at impact, so a hit marker can float there", () => {
    processContacts(queueOf([ballHandle, cartHandle, true]), ctx());

    // `makeBall` builds the ball at (0, 5, 0) and no world step moves it before the scripted
    // contact, so the impact position is the ball's own position.
    const p = ball.body.translation();
    expect(hitPositions).toEqual([{ x: p.x, y: p.y, z: p.z }]);
  });

  describe("who fired it", () => {
    it("reports the shooter a ball carries, not the cart it hit", () => {
      const fromBot = makeBall(20, 3);
      registry.registerBall(fromBot.handle, fromBot.ball);
      processContacts(queueOf([fromBot.handle, cartHandle, true]), ctx());

      // 3, and specifically not 0. Every ball reported 0 before Stage C, because there was
      // nowhere for the answer to live -- and 0 is the player, so it read as correct.
      expect(hits).toEqual([3]);
    });

    it("attributes a lethal hit to the shooter and names the victim's own index", () => {
      cart.health.hp = 1;
      const fromBot = makeBall(20, 3);
      registry.registerBall(fromBot.handle, fromBot.ball);
      processContacts(queueOf([fromBot.handle, cartHandle, true]), ctx());

      expect(kills).toEqual([{ victim: 0, killer: 3 }]);
    });

    it("attributes a ram kill to the other cart, both ways in one contact", () => {
      const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
      const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
      registry.registerCart(otherHandle, other, 1);
      cart.health.hp = 1;
      other.health.hp = 1;
      cart.heading = 0;
      cart.speed = 14;
      other.speed = 14;

      processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

      // Two deaths, each credited to the other cart. Not `NO_KILLER`, which is what a ram would
      // score if the shunt path forwarded a death without saying who caused it.
      expect(kills).toEqual([
        { victim: 0, killer: 1 },
        { victim: 1, killer: 0 },
      ]);
    });
  });

  describe("spawn protection", () => {
    it("takes no damage and earns the shooter no credit while it holds", () => {
      cart.protectedFor = 3;
      processContacts(queueOf([ballHandle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(hits).toEqual([]);
      expect(stats.directHits).toBe(0);
    });

    it("stops mattering the moment it runs out", () => {
      // The control. Without it the test above passes against `ballHitsCart` returning
      // unconditionally, which would make the cart immortal rather than protected.
      cart.protectedFor = 0;
      processContacts(queueOf([ballHandle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);
      expect(hits).toEqual([0]);
    });

    it("does not stop a ram", () => {
      // Deliberate, per the design: a cart that can be neither shot nor pushed can park itself
      // inside an enemy with impunity.
      const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
      const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
      registry.registerCart(otherHandle, other, 1);
      cart.protectedFor = 3;
      cart.heading = 0;
      cart.speed = 14;
      other.speed = 14;

      processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

      expect(cart.health.hp).toBeLessThan(ARENA_MAX_HEALTH);
    });
  });

  it("costs a flat point of health regardless of the cart's own speed", () => {
    // Old behavior scaled damage by the ball's speed relative to the cart, so a ball drifting
    // alongside a cart at matching velocity barely scratched it. Cart-only mode's flat damage
    // rule means that no longer matters -- confirm the cart moving does not change the outcome.
    cart.heading = 0;
    cart.speed = 30;
    processContacts(queueOf([ballHandle, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);
  });

  it("reports a kill exactly once even when two lethal contacts drain in the same tick", () => {
    cart.health.hp = 1;
    processContacts(
      queueOf([ballHandle, cartHandle, true], [ballHandle, cartHandle, true]),
      ctx(),
    );

    expect(cart.health.hp).toBe(0);
    expect(killed).toEqual([cart]);
  });

  it("damages both carts in a shunt and shoves both apart, never applying an impulse", () => {
    // Bars tall enough to read the raw shunt damage off, rather than clamping it at zero.
    cart.setMaxHealth(100);
    const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI, maxHealth: 100 });
    const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
    registry.registerCart(otherHandle, other, 1);

    cart.heading = 0;
    cart.speed = 14;
    other.speed = 14; // heading pi, so the two close at 28 m/s

    processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

    const expected = 28 * SHUNT_DAMAGE_PER_MPS;
    expect(cart.health.hp).toBeCloseTo(100 - expected, 6);
    expect(other.health.hp).toBeCloseTo(100 - expected, 6);
    // Pushed apart along the line between them: cart is at x=0, other at x=1.2.
    expect(cart.shuntVelocity.x).toBeLessThan(0);
    expect(other.shuntVelocity.x).toBeGreaterThan(0);
    // A shunt is not a stat-tracked shot, and the cart body must be untouched by it.
    expect(stats.directHits).toBe(0);
  });

  it("ignores a shunt below SHUNT_MIN_SPEED -- parking is not ramming", () => {
    const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
    const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
    registry.registerCart(otherHandle, other, 1);
    cart.speed = SHUNT_MIN_SPEED / 4;
    other.speed = SHUNT_MIN_SPEED / 4;

    processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(other.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(cart.shuntVelocity.x).toBe(0);
  });

  it("ignores separation events -- only the start of a contact is a hit", () => {
    processContacts(queueOf([ballHandle, cartHandle, false]), ctx());
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(stats.directHits).toBe(0);
  });

  it("ignores contacts involving anything it does not know about, like the ground", () => {
    processContacts(queueOf([ballHandle, 9999, true], [4242, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(stats.directHits).toBe(0);
  });

  it("ignores ball-vs-ball contacts", () => {
    const second = makeBall(-30);
    registry.registerBall(second.handle, second.ball);
    processContacts(queueOf([ballHandle, second.handle, true]), ctx());
    expect(stats.directHits).toBe(0);
  });

  describe("a ball hit is exactly one point", () => {
    it("costs one point of health, whatever the ball's speed", () => {
      const slow = makeBall(3);
      registry.registerBall(slow.handle, slow.ball);
      processContacts(queueOf([slow.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);

      const fast = makeBall(40);
      registry.registerBall(fast.handle, fast.ball);
      processContacts(queueOf([fast.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE * 2);
    });

    it("still counts the hit as a direct hit for accuracy stats", () => {
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.ball);
      processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
      expect(stats.directHits).toBe(1);
    });

    it("kills on the hit that empties the bar", () => {
      const small = new Cart({ maxHealth: 2 });
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.35, 0.6),
        world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
      );
      registry.registerCart(collider.handle, small, 1);
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.ball);

      processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
      expect(killed).toHaveLength(0);
      processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
      expect(small.health.hp).toBe(0);
      expect(killed).toEqual([small]);
    });

    it("ignores a hit on a cart that is already dead and awaiting respawn", () => {
      cart.dead = true;
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.ball);
      processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(stats.directHits).toBe(0);
    });

    it("leaves shunt damage velocity-scaled", () => {
      const other = new Cart();
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.35, 0.6),
        world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
      );
      registry.registerCart(collider.handle, other, 1);
      cart.heading = 0;
      cart.speed = 10;
      other.heading = Math.PI;
      other.speed = 10;

      processContacts(queueOf([cartHandle, collider.handle, true]), ctx());

      expect(cart.health.hp).toBeLessThan(ARENA_MAX_HEALTH - STROKE_DAMAGE);
    });
  });
});
