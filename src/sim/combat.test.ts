import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Cart } from "./entities/Cart";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import {
  CombatRegistry,
  RAM_MAX_DAMAGE,
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
      onBallHit: (shooter: number, _victim: number, _damage: number, x: number, y: number, z: number) => {
        hits.push(shooter);
        hitPositions.push({ x, y, z });
        stats.directHits += 1;
      },
      onCartKilled: (c: Cart, victim: number, killer: number) => {
        killed.push(c);
        kills.push({ victim, killer });
      },
      onRamDamage: () => {},
    };
  }

  /** A pooled ball, shaped as `BallPool` builds them. `firedBy` defaults to rig 1 -- an enemy of
   *  the rig-0 cart these tests shoot at. It was 0 until friendly fire went off, and a cart's own
   *  ball no longer hurts it. */
  function makeBall(vx: number, firedBy = 1): { ball: PooledBall; handle: number } {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(0.15).setDensity(1130), body);
    body.setLinvel({ x: vx, y: 0, z: 0 }, true);
    return { ball: { body, state: "flying", landedAt: 0, firedBy, firedAt: 0, spent: false, damage: STROKE_DAMAGE, touchedDown: false, restTicks: 0, position: new Float64Array(3), velocity: new Float64Array(3) }, handle: collider.handle };
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

  describe("friendly fire is off", () => {
    it("a teammate's ball does no damage and earns its shooter nothing", () => {
      // Rig 2 is on rig 0's team (`teamOf` alternates).
      const fromAlly = makeBall(20, 2);
      registry.registerBall(fromAlly.handle, fromAlly.ball);
      processContacts(queueOf([fromAlly.handle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(hits).toEqual([]);
      expect(kills).toEqual([]);
    });

    it("a cart's own ball does not hurt it", () => {
      const own = makeBall(20, 0);
      registry.registerBall(own.handle, own.ball);
      processContacts(queueOf([own.handle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(hits).toEqual([]);
    });

    it("an enemy's ball still does damage", () => {
      // The control for the two above: without it they pass against a `ballHitsCart` that never
      // does anything.
      const fromEnemy = makeBall(20, 3);
      registry.registerBall(fromEnemy.handle, fromEnemy.ball);
      processContacts(queueOf([fromEnemy.handle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);
      expect(hits).toEqual([3]);
    });

    it("teammates who collide take no damage but are still shoved apart", () => {
      const ally = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
      const allyBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      const allyHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), allyBody).handle;
      registry.registerCart(allyHandle, ally, 2);
      cart.heading = 0;
      cart.speed = 14;
      ally.speed = 14;

      processContacts(queueOf([cartHandle, allyHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(ally.health.hp).toBe(ARENA_MAX_HEALTH);
      // Pushed apart along the line between them: the ally is at +x, so the cart goes -x.
      expect(cart.shuntVelocity.x).toBeLessThan(-1);
      expect(ally.shuntVelocity.x).toBeGreaterThan(1);
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
      expect(hits).toEqual([1]);
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

  /** An enemy cart parked 1.2 m ahead of `cart` along +x, facing it. */
  function parkedEnemy(): Cart {
    const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
    const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
    registry.registerCart(otherHandle, other, 1);
    otherHandles.set(other, otherHandle);
    return other;
  }
  const otherHandles = new Map<Cart, number>();

  it("caps a head-on at the ram maximum for both carts and shoves both apart, never an impulse", () => {
    const other = parkedEnemy();
    cart.heading = 0;
    cart.speed = 14;
    other.speed = 14; // heading pi, so the two close at 28 m/s: a mutual ram, nobody's victim

    processContacts(queueOf([cartHandle, otherHandles.get(other)!, true]), ctx());

    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - RAM_MAX_DAMAGE);
    expect(other.health.hp).toBe(ARENA_MAX_HEALTH - RAM_MAX_DAMAGE);
    // Pushed apart along the line between them: cart is at x=0, other at x=1.2.
    expect(cart.shuntVelocity.x).toBeLessThan(0);
    expect(other.shuntVelocity.x).toBeGreaterThan(0);
    // A shunt is not a stat-tracked shot.
    expect(stats.directHits).toBe(0);
  });

  it("hurts but does not kill a full-health cart rammed at 10 m/s", () => {
    // At the old 0.8 damage per m/s this was 8 damage: every ram at speed was a kill.
    const other = parkedEnemy();
    cart.heading = 0;
    cart.speed = 10;

    processContacts(queueOf([cartHandle, otherHandles.get(other)!, true]), ctx());

    expect(other.dead).toBe(false);
    expect(other.health.hp).toBe(ARENA_MAX_HEALTH - 1);
    expect(kills).toEqual([]);
  });

  it("costs the rammer half what it deals the parked cart", () => {
    const other = parkedEnemy();
    cart.heading = 0;
    cart.speed = 14;

    processContacts(queueOf([cartHandle, otherHandles.get(other)!, true]), ctx());

    expect(other.health.hp).toBe(ARENA_MAX_HEALTH - 2);
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - 1);
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

  describe("a ball damages once per flight", () => {
    it("touching the hull and the capsule of one cart costs one point, not two", () => {
      const hullHandle = world.createCollider(
        RAPIER.ColliderDesc.cylinder(1.4, 0.9),
        world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
      ).handle;
      registry.registerCart(hullHandle, cart, 0);

      processContacts(queueOf([ballHandle, hullHandle, true], [ballHandle, cartHandle, true]), ctx());

      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - STROKE_DAMAGE);
      expect(stats.directHits).toBe(1);
    });

    it("does the damage the ball carries: a driver ball hits for its club's damage", () => {
      ball.damage = 2;
      processContacts(queueOf([ballHandle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH - 2);
    });

    it("a ball that has landed does no damage when a cart drives into it", () => {
      ball.state = "landed";
      processContacts(queueOf([ballHandle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
      expect(stats.directHits).toBe(0);
    });
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
      // From rig 0: the default shooter is rig 1, which would be this cart shooting itself.
      const ball = makeBall(20, 0);
      registry.registerBall(ball.handle, ball.ball);

      processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
      expect(killed).toHaveLength(0);
      // A second ball: one flight is one hit.
      const second = makeBall(20, 0);
      registry.registerBall(second.handle, second.ball);
      processContacts(queueOf([second.handle, collider.handle, true]), ctx());
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
