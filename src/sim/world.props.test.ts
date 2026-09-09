import type RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { CART_COLLIDER } from "./entities/Cart";
import { PIN_SHAPE } from "./entities/Pin";
import { BALL_RADIUS } from "./entities/ballShape";
import { CUP_RADIUS } from "./terrain";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import { Sim } from "./world";

/**
 * The pin, driven through a real `Sim` and a real Rapier world.
 *
 * The pin is knocked down *by the physics* rather than by a hit rule, so it has to actually be hit
 * to be tested: every assertion below moves a ball or a cart and reads what the world did with it.
 *
 * Two of these tests reach past `Sim`'s public surface to place the ball and to count colliders.
 * That is the same door `tools/feelProbe.ts` already uses and it is deliberate: `Sim` publishes
 * `pinStanding` for the renderer and nothing else, and adding a public collider accessor purely so
 * a test could read one would be putting test scaffolding in the shipped API.
 */

interface BallHandle {
  setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
  setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
}

function ballOf(sim: Sim): BallHandle {
  return (sim as unknown as { ball: BallHandle }).ball;
}

function colliderCount(sim: Sim): number {
  return (sim as unknown as { world: RAPIER.World }).world.colliders.len();
}

/** The live pin collider, or null once it has been felled. Read from Rapier, never from a copy. */
export function pinColliderOf(sim: Sim): RAPIER.Collider | null {
  return (sim as unknown as { pinCollider: RAPIER.Collider | null }).pinCollider;
}

const TICKS_PER_SECOND = 60;

/** Roll a ball at the cup from `metres` out, offset `lateral` metres across the line. */
function puttAtCup(sim: Sim, metres: number, speed: number, lateral = 0): void {
  const cup = sim.terrain.cupPosition;
  // Approached from the tee side, so the shot runs along the hole rather than across it.
  const angle = Math.atan2(sim.terrain.teePosition.z - cup.z, sim.terrain.teePosition.x - cup.x);
  const x = cup.x + Math.cos(angle) * metres - Math.sin(angle) * lateral;
  const z = cup.z + Math.sin(angle) * metres + Math.cos(angle) * lateral;
  const ball = ballOf(sim);
  ball.setTranslation({ x, y: sim.terrain.heightAt(x, z) + BALL_RADIUS, z }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  ball.setLinvel({ x: -Math.cos(angle) * speed, y: 0, z: -Math.sin(angle) * speed }, true);
}

/** Step until the ball is holed or `seconds` have gone by. Returns whether it dropped. */
function settle(sim: Sim, seconds = 8): boolean {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
    sim.step();
    if (sim.holedOut) return true;
  }
  return false;
}

/**
 * Roll a shot at the cup and report what the pin did to it. `closest` is the nearest the ball's
 * centre ever came to the cup axis, which is the measurement that says whether the pole was there:
 * a ball stopped by the pole cannot get inside `PIN_SHAPE.radius + BALL_RADIUS` of the axis, and a
 * ball with no pole in its way runs straight through that space.
 */
function shotAtPin(sim: Sim, speed: number): { holed: boolean; closest: number; rest: number } {
  const cup = sim.terrain.cupPosition;
  puttAtCup(sim, 3, speed);
  let closest = Infinity;
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) {
    sim.step();
    const p = sim.current.position;
    closest = Math.min(closest, Math.hypot(p.x - cup.x, p.z - cup.z));
    if (sim.holedOut) break;
  }
  const p = sim.current.position;
  return { holed: sim.holedOut, closest, rest: Math.hypot(p.x - cup.x, p.z - cup.z) };
}

/**
 * Put the player's cart on the tee side of the cup, aim it at the hole, and drive.
 *
 * `gapWhenFelled` is the cart's distance from the cup on the tick the pin fell, or 0 if it never
 * did -- the number that says the cart *met* the pole rather than passing through where it stood.
 * `closest` is how near the cart's centre ever came to the cup, which is what "drove over the hole"
 * means; the final position is no use for that, because a cart under full throttle keeps going.
 */
function driveAtCup(sim: Sim, ticks: number): { gapWhenFelled: number; closest: number } {
  const cup = sim.terrain.cupPosition;
  const tee = sim.terrain.teePosition;
  const angle = Math.atan2(tee.z - cup.z, tee.x - cup.x);
  const startX = cup.x + Math.cos(angle) * 4;
  const startZ = cup.z + Math.sin(angle) * 4;
  sim.cart.position.x = startX;
  sim.cart.position.z = startZ;
  sim.cart.position.y = sim.terrain.heightAt(startX, startZ) + CART_COLLIDER.groundOffset;
  sim.cart.heading = Math.atan2(cup.z - startZ, cup.x - startX);

  const source = new ScriptedInputSource([{ ticks, intent: { throttle: 1 } }]);
  let gapWhenFelled = 0;
  let closest = Infinity;
  for (let i = 0; i < ticks; i++) {
    const standingBefore = sim.pinStanding;
    sim.step(source.sample());
    source.endTick();
    const p = sim.cart.position;
    const gap = Math.hypot(p.x - cup.x, p.z - cup.z);
    closest = Math.min(closest, gap);
    if (standingBefore && !sim.pinStanding) gapWhenFelled = gap;
  }
  return { gapWhenFelled, closest };
}

/** A `Sim` whose pin has been knocked down by a ball, re-teed, ready for the same shot again. */
async function withPinFelled(): Promise<Sim> {
  const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  puttAtCup(sim, 3, 12);
  for (let i = 0; i < 5 * TICKS_PER_SECOND && sim.pinStanding; i++) sim.step();
  if (sim.pinStanding) throw new Error("the setup shot failed to fell the pin");
  // `reset()` re-tees the ball and deliberately does NOT stand the pin back up -- felled is felled
  // for the hole. That is what makes the same shot repeatable against a cleared cup.
  sim.reset();
  return sim;
}

describe("the pin as a sim object", () => {
  it("stands a pin at the cup on a fresh hole", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.pinStanding).toBe(true);
  });

  it("stands the pin's collider exactly where the cup is, base on the ground", async () => {
    // Half of spec criterion 2. The other half -- this collider against the *drawn* pole -- is in
    // `src/entities/Flagstick.test.ts`, because that comparison needs three and this file may not
    // import it. Split across two files, but never reduced to "each agrees with the same constant".
    const sim = await Sim.create(fixedHoleSpec());
    const collider = pinColliderOf(sim);
    expect(collider).not.toBeNull();

    const cup = sim.terrain.cupPosition;
    const centre = collider!.translation();
    expect(centre.x).toBeCloseTo(cup.x, 6);
    expect(centre.z).toBeCloseTo(cup.z, 6);
    // The collider is centre-anchored and the cup is on the ground. Getting that offset wrong in
    // the other direction is exactly the 0.26 m muzzle defect, so it is asserted rather than
    // assumed: collider *base* against cup height.
    expect(centre.y - collider!.halfHeight()).toBeCloseTo(cup.y, 6);
    expect(collider!.halfHeight() * 2).toBeCloseTo(PIN_SHAPE.height, 6);
    expect(collider!.radius()).toBeCloseTo(PIN_SHAPE.radius, 6);
  });

  it("keeps the pin thin enough that a ball can still reach the cup", () => {
    // Spec §2.1 as an inequality rather than a paragraph: a pin of radius r holds a ball's centre
    // at least r + BALL_RADIUS from the cup centre, so holing out with the pin in requires
    // r + BALL_RADIUS < CUP_RADIUS. This is the arithmetic the hole-out test below exercises.
    expect(PIN_SHAPE.radius + BALL_RADIUS).toBeLessThan(CUP_RADIUS);
  });

  it("removes and rebuilds the pin on loadHole rather than leaking one per hole", async () => {
    // `AGENTS.md`'s removal-path rule, asserted on the collider count rather than on a boolean.
    // A pin that was created but never removed shows up here as a count that climbs per hole.
    const sim = await Sim.create(fixedHoleSpec());
    const before = colliderCount(sim);

    for (let i = 1; i <= 3; i++) sim.loadHole({ ...fixedHoleSpec(), index: i, seed: 900 + i });

    expect(colliderCount(sim)).toBe(before);
    expect(sim.pinStanding).toBe(true);
    expect(pinColliderOf(sim)).not.toBeNull();
  });

  it("does not spawn a bot inside the pin", async () => {
    // Spec §7: bots spawn from `terrain.cupPosition`, which is where the pin now stands.
    const sim = await Sim.create(fixedHoleSpec());
    const cup = sim.terrain.cupPosition;
    expect(sim.bots.length).toBeGreaterThan(0);
    for (const bot of sim.bots) {
      const gap = Math.hypot(bot.position.x - cup.x, bot.position.z - cup.z);
      expect(gap).toBeGreaterThan(PIN_SHAPE.radius + BALL_RADIUS);
    }
  });

  it("still holes out with the pin standing, which is what §2.1 promises", async () => {
    // Spec criterion 3, the half that is easy to lose: making the pin solid must not make the hole
    // unreachable.
    //
    // **`pinStanding` at the moment it drops is the whole assertion.** Without it this test passes
    // at any pin radius at all -- verified, not assumed: at radius 0.45 the ball cannot reach the
    // cup, so it strikes the fat pole, fells it, and rolls into the now-clear hole. "It holed" and
    // "it holed with the pin in" are two claims about different things, and only the second is
    // §2.1 under test rather than §2.1 restated.
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    expect(sim.pinStanding).toBe(true);

    puttAtCup(sim, 2, 2.6);
    expect(settle(sim)).toBe(true);
    expect(sim.pinStanding).toBe(true);
  });
});

/**
 * Spec criteria 3 and 4, **rewritten against the measurement**.
 *
 * The spec asked for the opposite of what the physics does, and its own §2.1 arithmetic is why.
 * `isInCup` holes the ball whenever its centre is within `CUP_RADIUS` (0.55) and it is slower than
 * `HOLE_OUT_SPEED`; the pole's surface is at `PIN_SHAPE.radius` (0.025), so a ball can only *touch*
 * it once its centre is 0.175 m from the axis -- 0.375 m **inside** the hole-out radius. Anything
 * that reaches the pole is therefore already deep in the cup and is unholed only because it is too
 * fast, and a collision can only take speed away. A sweep of ~180 rolling shots and ~96 lofted ones
 * found no case where the standing pin turned a hole into a miss, and there cannot be one.
 *
 * So the pin is a **backstop**, which is real golf's flagstick-in rule pointing the other way: it
 * catches a hot approach and drops it, and knocking it down gives that up in exchange for a cup a
 * cart can drive over. `isInCup` is still untouched and still needs no exception.
 */
describe("the pin as a backstop", () => {
  it("catches a hot approach and drops it, where a cleared cup lets it run past", async () => {
    // One shot, two pin states, compared directly -- not one shot against a remembered number.
    // 7.0 m/s arrives at the cup above HOLE_OUT_SPEED, so without something to stop it the ball
    // crosses the cup mouth and keeps going.
    const standing = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const withPin = shotAtPin(standing, 7);

    const felled = await withPinFelled();
    const withoutPin = shotAtPin(felled, 7);

    expect(withPin.holed).toBe(true);
    expect(withoutPin.holed).toBe(false);
    // Not marginally past: the cleared cup lets it run metres away.
    expect(withoutPin.rest).toBeGreaterThan(4);
  });

  it("stops the ball at the pole's surface while standing, and at nothing once felled", async () => {
    // The geometric half of the same pair, and the one that proves the *collider* is what changed.
    // A ball held off by the pole cannot bring its centre inside radius + BALL_RADIUS of the axis;
    // a ball with the pole gone rolls straight through where it stood.
    const reach = PIN_SHAPE.radius + BALL_RADIUS;

    const standing = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const withPin = shotAtPin(standing, 7);
    expect(withPin.closest).toBeGreaterThanOrEqual(reach - 0.005);

    const felled = await withPinFelled();
    const withoutPin = shotAtPin(felled, 7);
    expect(withoutPin.closest).toBeLessThan(reach);
    // Through the pole's own footprint, not merely nearer than before.
    expect(withoutPin.closest).toBeLessThan(PIN_SHAPE.radius * 4);
  });
});

describe("knocking the pin down", () => {
  it("is felled by a struck ball, and the collider goes with it", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const before = colliderCount(sim);

    puttAtCup(sim, 3, 12);
    for (let i = 0; i < 5 * TICKS_PER_SECOND && sim.pinStanding; i++) sim.step();

    expect(sim.pinStanding).toBe(false);
    // The collider count, not the boolean: `AGENTS.md`'s removal-path rule is about the resource.
    expect(colliderCount(sim)).toBe(before - 1);
    expect(pinColliderOf(sim)).toBeNull();
  });

  it("is felled by a cart driving into it", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const before = colliderCount(sim);
    driveAtCup(sim, 4 * TICKS_PER_SECOND);

    expect(sim.pinStanding).toBe(false);
    expect(colliderCount(sim)).toBe(before - 1);
  });

  it("stays down for the hole, through a re-tee, and stands again on the next", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    puttAtCup(sim, 3, 12);
    for (let i = 0; i < 5 * TICKS_PER_SECOND && sim.pinStanding; i++) sim.step();
    expect(sim.pinStanding).toBe(false);
    const felledCount = colliderCount(sim);

    // Down for the hole is the whole of D3's economy: a pin you could re-tee to get back would
    // make the stroke you spent on it refundable.
    sim.reset();
    expect(sim.pinStanding).toBe(false);
    expect(colliderCount(sim)).toBe(felledCount);

    sim.loadHole({ ...fixedHoleSpec(), index: 1, seed: 3131 });
    expect(sim.pinStanding).toBe(true);
    expect(pinColliderOf(sim)).not.toBeNull();
    // Rebuilt, not resurrected: back to the standing count rather than one above it.
    expect(colliderCount(sim)).toBe(felledCount + 1);
  });
});

describe("a cart and the cup", () => {
  it("is stopped by a standing pin short of the cup, and drives over a felled one", async () => {
    // Spec criterion 12. The standing case cannot be "the cart never reaches the cup", because
    // hitting the pin fells it and then the cart goes through -- so what is asserted is that the
    // pin went down while the cart was still short of it. That is the cart meeting the pole.
    const standing = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const approach = driveAtCup(standing, 4 * TICKS_PER_SECOND);
    expect(standing.pinStanding).toBe(false);
    // Still short of the cup when the pin went down, by more than the pole's own thickness: the
    // cart's capsule reached the pole while its centre was a capsule-radius away.
    expect(approach.gapWhenFelled).toBeGreaterThan(CART_COLLIDER.radius);

    const felled = await withPinFelled();
    const before = colliderCount(felled);
    const overTheHole = driveAtCup(felled, 4 * TICKS_PER_SECOND);
    // Straight over the hole: nothing there to stop it, and nothing changed by arriving. Measured
    // on the closest approach rather than where it ended up -- full throttle does not stop at a cup.
    expect(overTheHole.closest).toBeLessThan(PIN_SHAPE.radius + CART_COLLIDER.radius);
    expect(colliderCount(felled)).toBe(before);
    expect(felled.pinStanding).toBe(false);
  });
});
