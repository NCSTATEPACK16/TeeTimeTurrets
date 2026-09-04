import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Cart, STARTING_HP } from "./entities/Cart";
import { Target } from "./entities/Target";
import {
  CombatRegistry,
  MAX_HIT_DAMAGE,
  MIN_HIT_DAMAGE,
  SHUNT_DAMAGE_PER_MPS,
  SHUNT_MIN_SPEED,
  STROKE_DAMAGE,
  hitDamage,
  processContacts,
} from "./combat";
import type { CollisionEventSource } from "./combat";
import { createStats } from "./stats";
import type { Stats } from "./stats";

/**
 * Dispatch is tested against a fake queue exposing only `drainCollisionEvents` -- the whole
 * surface `processContacts` uses -- so the contact cases can be scripted exactly instead of
 * being staged in a physics world and hoped for. The entities either side of a contact
 * (`Target`, `Cart`, ball bodies) are the real ones.
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
  let target: Target;
  let cart: Cart;
  let cartHandle: number;
  let ball: RAPIER.RigidBody;
  let ballHandle: number;
  let killed: Cart[];

  beforeAll(async () => {
    await RAPIER.init();
  });

  function ctx() {
    return { registry, stats, onCartKilled: (c: Cart) => killed.push(c) };
  }

  function makeBall(vx: number): { body: RAPIER.RigidBody; handle: number } {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(0.15).setDensity(1130), body);
    body.setLinvel({ x: vx, y: 0, z: 0 }, true);
    return { body, handle: collider.handle };
  }

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    registry = new CombatRegistry();
    stats = createStats();
    killed = [];

    target = new Target(world, { x: 10, y: 0, z: 0 });
    registry.registerTarget(target);

    cart = new Cart({ position: { x: 0, y: 0, z: 0 } });
    const cartBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    cartHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), cartBody).handle;
    registry.registerCart(cartHandle, cart);

    const made = makeBall(30);
    ball = made.body;
    ballHandle = made.handle;
    registry.registerBall(ballHandle, ball);
  });

  it("a ball hitting a target part knocks the rig down and counts one hit and one target", () => {
    const part = target.part("torso");
    processContacts(queueOf([ballHandle, part.collider.handle, true]), ctx());

    expect(target.isDown).toBe(true);
    expect(stats.directHits).toBe(1);
    expect(stats.targetsDown).toBe(1);
  });

  it("counts targetsDown once per target however many parts are hit", () => {
    processContacts(
      queueOf(
        [ballHandle, target.part("torso").collider.handle, true],
        [ballHandle, target.part("head").collider.handle, true],
      ),
      ctx(),
    );

    expect(stats.directHits).toBe(2);
    expect(stats.targetsDown).toBe(1);
  });

  it("shoves the struck part along the ball's travel direction", () => {
    const part = target.part("torso");
    processContacts(queueOf([part.collider.handle, ballHandle, true]), ctx());
    expect(part.body.linvel().x).toBeGreaterThan(0);
  });

  it("a ball hitting a cart costs one point of health and counts a direct hit", () => {
    processContacts(queueOf([ballHandle, cartHandle, true]), ctx());

    expect(stats.directHits).toBe(1);
    expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE);
  });

  it("clamps a full-charge driver hit to MAX_HIT_DAMAGE and a putter tap to MIN_HIT_DAMAGE", () => {
    expect(hitDamage(40)).toBe(MAX_HIT_DAMAGE);
    expect(hitDamage(2)).toBe(MIN_HIT_DAMAGE);
    expect(hitDamage(0)).toBe(MIN_HIT_DAMAGE);
  });

  it("costs a flat point of health regardless of the cart's own speed", () => {
    // Old behavior scaled damage by the ball's speed relative to the cart, so a ball drifting
    // alongside a cart at matching velocity barely scratched it. Cart-only mode's flat damage
    // rule means that no longer matters -- confirm the cart moving does not change the outcome.
    cart.heading = 0;
    cart.speed = 30;
    processContacts(queueOf([ballHandle, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE);
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
    const other = new Cart({ position: { x: 1.2, y: 0, z: 0 }, heading: Math.PI });
    const otherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const otherHandle = world.createCollider(RAPIER.ColliderDesc.capsule(0.35, 0.6), otherBody).handle;
    registry.registerCart(otherHandle, other);

    cart.heading = 0;
    cart.speed = 14;
    other.speed = 14; // heading pi, so the two close at 28 m/s

    processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

    const expected = 28 * SHUNT_DAMAGE_PER_MPS;
    expect(cart.health.hp).toBeCloseTo(STARTING_HP - expected, 6);
    expect(other.health.hp).toBeCloseTo(STARTING_HP - expected, 6);
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
    registry.registerCart(otherHandle, other);
    cart.speed = SHUNT_MIN_SPEED / 4;
    other.speed = SHUNT_MIN_SPEED / 4;

    processContacts(queueOf([cartHandle, otherHandle, true]), ctx());

    expect(cart.health.hp).toBe(STARTING_HP);
    expect(other.health.hp).toBe(STARTING_HP);
    expect(cart.shuntVelocity.x).toBe(0);
  });

  it("ignores separation events -- only the start of a contact is a hit", () => {
    processContacts(queueOf([ballHandle, cartHandle, false]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP);
    expect(stats.directHits).toBe(0);
  });

  it("ignores contacts involving anything it does not know about, like the ground", () => {
    processContacts(queueOf([ballHandle, 9999, true], [4242, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP);
    expect(stats.directHits).toBe(0);
  });

  it("ignores ball-vs-ball contacts", () => {
    const second = makeBall(-30);
    registry.registerBall(second.handle, second.body);
    processContacts(queueOf([ballHandle, second.handle, true]), ctx());
    expect(stats.directHits).toBe(0);
  });

  it("forgets a target's colliders once it is unregistered", () => {
    const handle = target.part("torso").collider.handle;
    registry.unregisterTarget(target);
    processContacts(queueOf([ballHandle, handle, true]), ctx());
    expect(target.isDown).toBe(false);
    expect(stats.directHits).toBe(0);
  });

  describe("a ball hit is exactly one stroke", () => {
    it("costs one point of health and one stroke, whatever the ball's speed", () => {
      const slow = makeBall(3);
      registry.registerBall(slow.handle, slow.body);
      processContacts(queueOf([slow.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE);
      expect(cart.strokesTaken).toBe(1);

      const fast = makeBall(40);
      registry.registerBall(fast.handle, fast.body);
      processContacts(queueOf([fast.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE * 2);
      expect(cart.strokesTaken).toBe(2);
    });

    it("still counts the hit as a direct hit for accuracy stats", () => {
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.body);
      processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
      expect(stats.directHits).toBe(1);
    });

    it("kills on the hit that empties a bar sized to par", () => {
      const small = new Cart({ maxHealth: 2 });
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.35, 0.6),
        world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
      );
      registry.registerCart(collider.handle, small);
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.body);

      processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
      expect(killed).toHaveLength(0);
      processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
      expect(small.health.hp).toBe(0);
      expect(small.strokesTaken).toBe(2);
      expect(killed).toEqual([small]);
    });

    it("ignores a hit on a cart that is already dead and awaiting respawn", () => {
      cart.dead = true;
      const ball = makeBall(20);
      registry.registerBall(ball.handle, ball.body);
      processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
      expect(cart.health.hp).toBe(STARTING_HP);
      expect(cart.strokesTaken).toBe(0);
      expect(stats.directHits).toBe(0);
    });

    it("leaves shunt damage velocity-scaled and free of strokes", () => {
      const other = new Cart();
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.35, 0.6),
        world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
      );
      registry.registerCart(collider.handle, other);
      cart.heading = 0;
      cart.speed = 10;
      other.heading = Math.PI;
      other.speed = 10;

      processContacts(queueOf([cartHandle, collider.handle, true]), ctx());

      expect(cart.health.hp).toBeLessThan(STARTING_HP - STROKE_DAMAGE);
      expect(cart.strokesTaken).toBe(0);
      expect(other.strokesTaken).toBe(0);
    });
  });
});
