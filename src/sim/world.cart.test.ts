import { beforeEach, describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { CART_COLLIDER, RESPAWN_DELAY_S, STARTING_AMMO } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { POOL_SIZE } from "./entities/BallPool";
import type { BallPool, PooledBall } from "./entities/BallPool";
import type { Bucket } from "./entities/Pickup";
import { SurfaceId } from "./surfaces";
import { MATCH_DURATION_S, POOL_TRANSFORM_STRIDE, Sim, SwingMode } from "./world";
import { neutralIntent } from "../input/InputSource";

/**
 * Phase 2's gate, run headlessly against the real Rapier world. Everything here is driven
 * through `ScriptedInputSource` rather than by calling Sim methods directly -- that is the
 * point of the gate, not an implementation detail. If the cart can only be exercised by
 * reaching past the InputSource interface, the interface is still keyboard-shaped and Phase 4's
 * touch layer will pay for it.
 */

const TICKS_PER_SECOND = 60;

function seconds(n: number): number {
  return Math.round(n * TICKS_PER_SECOND);
}

/** Run a script to completion, then hold neutral for `tail` extra ticks so motion can settle. */
function play(sim: Sim, script: readonly ScriptedStep[], tail = 0): void {
  const source = new ScriptedInputSource(script);
  const total = script.reduce((sum, step) => sum + step.ticks, 0) + tail;
  for (let i = 0; i < total; i++) {
    sim.step(source.sample());
    source.endTick();
  }
}

/**
 * Full-charge shot with whatever club is equipped, measured as how far the pooled ball it spawns
 * gets from the cart. Sampled every tick rather than read at the end because a pooled ball is
 * released back to the pool once it lands, so its final resting place is not readable -- and it
 * is the pooled ball, not `Sim.ball`, that a shot moves now that cart mode is the only mode.
 */
function fullShotDistance(sim: Sim): number {
  const from = { ...sim.cart.position };
  play(sim, [{ ticks: seconds(2), intent: { fire: true } }, { ticks: 2, intent: {} }]);

  let farthest = 0;
  for (let tick = 0; tick < seconds(8); tick++) {
    sim.step();
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
      const d = Math.hypot(
        sim.currentPoolTransforms[flat]! - from.x,
        sim.currentPoolTransforms[flat + 2]! - from.z,
      );
      if (d > farthest) farthest = d;
    }
  }
  return farthest;
}

describe("cart in the world", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("spawns the cart resting on the terrain rather than inside or above it", () => {
    play(sim, [{ ticks: seconds(1), intent: {} }]);
    const p = sim.cart.position;
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z));
    expect(p.y - sim.terrain.heightAt(p.x, p.z)).toBeLessThan(2);
  });

  it("drives forward under throttle without falling through the ground", () => {
    const start = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(3), intent: { throttle: 1 } }]);
    const p = sim.cart.position;

    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    // The tunneling check the AGENTS.md testing invariants ask for, applied to the cart:
    // a body that fell through the heightfield diverges downward instead of tracking it.
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z) - 0.5);
  });

  it("steers the chassis while driving", () => {
    play(sim, [{ ticks: seconds(2), intent: { throttle: 1, steer: 1 } }]);
    expect(Math.abs(sim.cart.heading)).toBeGreaterThan(0.3);
  });

  it("stays on the field when driven at the edge for a long time", () => {
    play(sim, [{ ticks: seconds(30), intent: { throttle: -1 } }]);
    const p = sim.cart.position;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("holds an aim offset relative to the chassis rather than an absolute world yaw", () => {
    play(sim, [{ ticks: seconds(1), intent: { throttle: 1, steer: 1, aimDelta: -0.01 } }]);
    expect(sim.cart.turretOffset).toBeLessThan(0);
    expect(sim.cart.heading).toBeGreaterThan(0);
    expect(sim.cart.turretYaw).toBeCloseTo(sim.cart.heading + sim.cart.turretOffset, 9);
  });

  it("fires straight over the bonnet when the player never touches the aim control", () => {
    // Aiming is optional: drive, point the cart, shoot. The turret only leaves the chassis
    // heading if the player asks it to.
    play(sim, [{ ticks: seconds(2), intent: { throttle: 1, steer: -0.6 } }]);
    expect(sim.cart.heading).toBeLessThan(-0.3);
    expect(sim.cart.turretYaw).toBeCloseTo(sim.cart.heading, 9);
  });

  it("exposes the terrain and surfaces built from the hole it was created with", () => {
    expect(sim.terrain.spec.fieldSize).toBe(160);
    expect(sim.terrain.spec.tee).toEqual({ x: -45, z: 0 });
    expect(sim.surfaces.surfaceAt(sim.terrain.cupPosition.x, sim.terrain.cupPosition.z)).toBe(
      SurfaceId.Green,
    );
  });

  it("loadHole swaps the ground collider and re-tees onto the new hole", () => {
    const next: HoleSpec = { ...fixedHoleSpec(), seed: 999, tee: { x: 20, z: -20 } };
    sim.loadHole(next);

    expect(sim.terrain.spec.seed).toBe(999);
    expect(sim.current.position.x).toBeCloseTo(20, 5);
    expect(sim.current.position.z).toBeCloseTo(-20, 5);
    expect(sim.strokes).toBe(0);

    // The ball must be standing on the *new* heightfield, not the old one: step it and confirm
    // it settles rather than falling through to the out-of-bounds floor.
    for (let i = 0; i < 180; i++) sim.step();
    expect(sim.current.position.y).toBeGreaterThan(
      sim.terrain.heightAt(sim.current.position.x, sim.current.position.z) - 0.5,
    );
  });

  it("loadHole releases every pooled ball back to idle and repositions the bucket for the new hole", () => {
    play(sim, [{ ticks: 1, intent: {} }]);

    // Force the whole pool into "flying" -- the exhaustion state that would otherwise leak a
    // dead pool (or, before this fix, a bucket and stray balls at the old hole's coordinates)
    // into the new hole. There is no public API for this, so reach into the private fields
    // directly (still accessible at runtime -- TS privacy is compile-time only).
    const pool = (sim as unknown as { ballPool: BallPool }).ballPool;
    const balls = (pool as unknown as { balls: PooledBall[] }).balls;
    expect(balls.length).toBeGreaterThan(0);
    for (const b of balls) b.state = "flying";
    expect(pool.acquire()).toBeNull();

    const next: HoleSpec = { ...fixedHoleSpec(), seed: 555, tee: { x: 30, z: 15 } };
    sim.loadHole(next);

    // Every ball must be back to idle -- acquire() must succeed again immediately.
    expect(pool.acquire()).not.toBeNull();

    // The hardcoded bucket must follow the new hole's tee, not stay at the old hole's.
    const buckets = (sim as unknown as { buckets: Bucket[] }).buckets;
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[0].position.x).toBeCloseTo(next.tee.x + 10, 5);
    expect(buckets[0].position.z).toBeCloseTo(next.tee.z, 5);
  });

  it("loadHole frees pool slots so a fresh cart-mode shot after it still spawns a ball", () => {
    play(sim, [{ ticks: 1, intent: {} }]);

    const pool = (sim as unknown as { ballPool: BallPool }).ballPool;
    const balls = (pool as unknown as { balls: PooledBall[] }).balls;
    for (const b of balls) b.state = "flying";
    expect(pool.acquire()).toBeNull();

    const next: HoleSpec = { ...fixedHoleSpec(), seed: 777, tee: { x: -10, z: 40 } };
    sim.loadHole(next);

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.lastShotWasStrike).toBe(true);
  });
});

describe("striking the ball from the cart", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("equips the club the player selects and uses its stats for the shot", async () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Putter } }]);
    expect(sim.cart.equippedClub).toBe(ClubType.Putter);

    // Compared against a driver on an identical course rather than against a magic number:
    // `Sim.launch` used to hardcode DEFAULT_CLUB, so what needs proving is that selection
    // reaches Ballistics at all, and the two clubs' relative carry is what shows it.
    const putterDistance = fullShotDistance(sim);
    const driverSim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    play(driverSim, [{ ticks: 1, intent: { selectClub: ClubType.Driver } }]);
    const driverDistance = fullShotDistance(driverSim);

    // Guard the asymmetric trivial pass: a putter shot that silently spawns no ball at all --
    // out of ammo, pool exhausted, a regression in the fire gate -- measures 0, and 0 is less
    // than any driver distance. The comparison alone would call that a pass.
    expect(putterDistance).toBeGreaterThan(0);
    expect(putterDistance).toBeLessThan(driverDistance * 0.6);
  });

  it("drives the whole gate through the input interface with no direct Sim calls", () => {
    // Meta-check: one script covering club, drive, aim and fire, asserting the sim ends
    // somewhere sane. If this ever needs a direct method call to work, the interface is wrong.
    const source = new ScriptedInputSource([
      { ticks: 1, intent: { selectClub: ClubType.Iron } },
      { ticks: seconds(2), intent: { throttle: 1, steer: 0.4 } },
      { ticks: seconds(1), intent: { brake: true } },
      { ticks: seconds(1), intent: { aimDelta: 0.01 } },
      { ticks: seconds(1.2), intent: { fire: true } },
      { ticks: seconds(3), intent: {} },
    ]);
    while (!source.finished) {
      sim.step(source.sample());
      source.endTick();
    }
    expect(sim.cart.equippedClub).toBe(ClubType.Iron);
    expect(Number.isFinite(sim.cart.position.y)).toBe(true);
    expect(Number.isFinite(sim.current.position.y)).toBe(true);
  });
});

describe("the dormant stroke-play swing", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  /**
   * The only thing keeping `Sim.launch()` and `resolveShot`'s stationary branch honest. Since
   * cart-only mode no input path reaches either, and `Sim.launch` has exactly one call site in
   * the tree -- that branch. Without this test they would be proven to compile and nothing more,
   * while `Sim.mode`'s docstring, UI-SPEC §1 and BACKLOG 20b all promise a *working* reference
   * for the future true-golf mode. Whoever revives that mode needs to know the path did not rot
   * in the interim, and a compiling-only reference cannot tell them.
   *
   * Reaching into `Sim.mode` is the point rather than a shortcut: it is the only remaining way in.
   */
  it("still plays the course ball and counts a stroke when the mode is set back to Stationary", () => {
    sim.mode = SwingMode.Stationary;
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Driver } }]);
    const from = { ...sim.current.position };

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.strokes).toBe(1);

    // Measured in flight rather than after it settles: a shot that lands in water or out of
    // bounds is returned to the tee, which would read as "never launched". What is under test
    // is that `launch()` imparts velocity at all, not where the ball ends up.
    play(sim, [{ ticks: seconds(0.5), intent: {} }]);
    const p = sim.current.position;
    expect(Math.hypot(p.x - from.x, p.z - from.z)).toBeGreaterThan(5);
  });
});

describe("cart-mode ammo-aware combat shots", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("a fire with ammo spawns a pooled ball at the muzzle and it flies", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    expect(sim.cart.ammo).toBeGreaterThan(0);
    const ammoBefore = sim.cart.ammo;

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.lastShotWasStrike).toBe(true);
  });

  it("firing at 0 ammo produces a recoil-only blank: no strike, ammo stays at 0", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    sim.cart.ammo = 0;
    const recoilBefore = { x: sim.cart.recoil.x, z: sim.cart.recoil.z };

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    expect(sim.cart.recoil.x).not.toBeCloseTo(recoilBefore.x, 9);
  });

  it("blocks a second shot until the fired club's reload elapses", () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Driver } }]);
    const ammoBefore = sim.cart.ammo;
    play(sim, [
      { ticks: seconds(1.5), intent: { fire: true } },
      { ticks: 2, intent: {} },
      { ticks: seconds(0.2), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);
    expect(sim.cart.ammo).toBe(ammoBefore - 1);
  });

  it("driving over the dormant course ball costs nothing", () => {
    // The course ball rests at the tee and the cart spawns behind it, so this is the drive every
    // hole opens with. It is a hazard only if the dormant ball is a combat actor.
    play(sim, [{ ticks: 1, intent: {} }]);
    const hpBefore = sim.cart.health.hp;
    play(sim, [{ ticks: seconds(3), intent: { throttle: 1 } }]);

    expect(sim.cart.strokesTaken).toBe(0);
    expect(sim.cart.health.hp).toBe(hpBefore);
    expect(sim.cart.dead).toBe(false);
    // And it really did drive over the tee, or the assertions above prove nothing.
    expect(sim.cart.position.x).toBeGreaterThan(sim.terrain.teePosition.x);
  });
});

describe("targets, damage and respawn", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  /** The private hook combat.ts calls on a kill. Driving HP to zero through a real contact is
   * combat.test.ts's job; what this suite owns is what the *world* does about a death. */
  function kill(s: Sim): void {
    (s as unknown as { killCart: (cart: Cart) => void }).killCart(s.cart);
  }

  it("places standing targets on the course", () => {
    expect(sim.targets.length).toBeGreaterThan(0);
    for (const target of sim.targets) {
      expect(target.isDown).toBe(false);
      const pelvis = target.part("pelvis").body.translation();
      expect(pelvis.y).toBeGreaterThan(sim.terrain.heightAt(pelvis.x, pelvis.z));
    }
  });

  it("a ball fired into a target knocks it down and records the hit", () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Putter } }]);

    // Park the cart six metres short of the nearest target, aimed straight at it, and putt: at
    // that standoff the putter's flat arc crosses the target plane at torso height. Placing the
    // cart directly is the only way to get a repeatable firing line -- driving there would make
    // the assertion a test of the terrain rather than of hit detection.
    const torso = sim.targets[0].part("torso").body.translation();
    const standoff = 6;
    sim.cart.heading = 0;
    sim.cart.turretOffset = 0;
    sim.cart.position.x = torso.x - standoff;
    sim.cart.position.z = torso.z;
    sim.cart.position.y =
      sim.terrain.heightAt(torso.x - standoff, torso.z) + CART_COLLIDER.groundOffset;

    play(sim, [{ ticks: seconds(1), intent: { fire: true } }, { ticks: seconds(3), intent: {} }]);

    expect(sim.targets[0].isDown).toBe(true);
    expect(sim.stats.targetsDown).toBe(1);
    expect(sim.stats.directHits).toBeGreaterThanOrEqual(1);
  });

  it("counts a shot that spawned a ball, and does not count a blank", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);

    sim.cart.ammo = 0;
    play(sim, [{ ticks: seconds(3), intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);
  });

  it("a death freezes the cart for the respawn delay without charging its own stroke", () => {
    play(sim, [{ ticks: seconds(1), intent: { throttle: 1 } }]);
    const strokesBefore = sim.cart.strokesTaken;
    const ammoBefore = sim.cart.ammo;

    kill(sim);
    expect(sim.cart.dead).toBe(true);
    // The hit that emptied the bar counted its own stroke; the death itself is not a second one.
    expect(sim.cart.strokesTaken).toBe(strokesBefore);

    const frozen = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S - 0.5), intent: { throttle: 1, fire: true } }]);

    expect(sim.cart.dead).toBe(true);
    expect(sim.cart.position.x).toBeCloseTo(frozen.x, 9);
    expect(sim.cart.position.z).toBeCloseTo(frozen.z, 9);
    expect(sim.cart.ammo).toBe(ammoBefore);
  });

  it("respawns at the tee-adjacent spawn point at full health once the delay elapses", () => {
    play(sim, [{ ticks: seconds(2), intent: { throttle: 1 } }]);
    kill(sim);
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S + 0.5), intent: {} }]);

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
    expect(sim.cart.position.x).toBeCloseTo(sim.terrain.teePosition.x - 2.5, 5);
    expect(sim.cart.position.z).toBeCloseTo(sim.terrain.teePosition.z, 5);
  });

  it("only one death per life: a second kill while dead does not restart the respawn timer", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    kill(sim);
    play(sim, [{ ticks: seconds(1), intent: {} }]);
    const timer = sim.cart.respawnTimer;
    expect(timer).toBeLessThan(RESPAWN_DELAY_S);

    kill(sim);
    expect(sim.cart.respawnTimer).toBeCloseTo(timer, 9);
  });

  it("reset() heals a mid-respawn cart and stands every target back up", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    sim.targets[0].knockDown(sim.targets[0].part("torso"), { x: 40, y: 0, z: 0 });
    kill(sim);
    expect(sim.cart.dead).toBe(true);

    sim.reset();

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.respawnTimer).toBe(0);
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
    expect(sim.targets[0].isDown).toBe(false);
  });

  it("keeps round stats across reset() -- a round is a sequence of holes", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);

    sim.reset();
    expect(sim.stats.shotsFired).toBe(1);

    sim.loadHole({ ...fixedHoleSpec(), seed: 4242 });
    expect(sim.stats.shotsFired).toBe(1);
  });

  it("loadHole rebuilds the targets onto the new hole's terrain", () => {
    const next: HoleSpec = { ...fixedHoleSpec(), seed: 321, tee: { x: 25, z: -25 } };
    sim.loadHole(next);

    expect(sim.targets.length).toBeGreaterThan(0);
    for (const target of sim.targets) {
      expect(target.isDown).toBe(false);
      const pelvis = target.part("pelvis").body.translation();
      expect(pelvis.y).toBeGreaterThan(sim.terrain.heightAt(pelvis.x, pelvis.z));
    }
  });

  it("sizes the player's health bar at twice the hole's par", () => {
    expect(sim.terrain.spec.par).toBe(3);
    expect(sim.cart.health.max).toBe(6);
    expect(sim.cart.health.hp).toBe(6);
  });

  it("resizes the health bar when loadHole brings a different par", () => {
    sim.loadHole({ ...fixedHoleSpec(), par: 5, seed: 4141 });
    expect(sim.cart.health.max).toBe(10);
    expect(sim.cart.health.hp).toBe(10);
  });

  it("reset clears strokesTaken", () => {
    sim.cart.strokesTaken = 4;
    sim.reset();
    expect(sim.cart.strokesTaken).toBe(0);
  });
});

describe("bot carts", () => {
  it("creates one bot by default, on the terrain and out past the cup", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.bots).toHaveLength(1);

    const bot = sim.bots[0]!;
    const cup = sim.terrain.cupPosition;
    expect(bot.position.x).toBeCloseTo(cup.x + 2.5, 5);
    expect(bot.position.z).toBeCloseTo(cup.z, 5);
    expect(bot.position.y).toBeGreaterThan(sim.terrain.heightAt(bot.position.x, bot.position.z));
  });

  it("creates none when the caller asks for none", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    expect(sim.bots).toHaveLength(0);
    expect(sim.currentBotCarts).toHaveLength(0);
  });

  it("gives every bot its own health bar sized to par", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.bots[0]!.health.max).toBe(2 * sim.terrain.spec.par);
    expect(sim.bots[0]!.health.hp).toBe(sim.bots[0]!.health.max);
  });

  it("publishes a render transform per bot and keeps it in step with the sim", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.currentBotCarts).toHaveLength(1);
    expect(sim.previousBotCarts).toHaveLength(1);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.currentBotCarts[0]!.position.x).toBeCloseTo(sim.bots[0]!.position.x, 9);
    expect(sim.currentBotCarts[0]!.position.z).toBeCloseTo(sim.bots[0]!.position.z, 9);
  });

  it("settles the bot onto the ground rather than leaving it hanging or sunk", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    for (let i = 0; i < 120; i++) sim.step();
    const bot = sim.bots[0]!;
    const ground = sim.terrain.heightAt(bot.position.x, bot.position.z);
    expect(bot.position.y - ground).toBeGreaterThan(0);
    expect(bot.position.y - ground).toBeLessThan(2);
  });

  /** `resolveShot` is private and, since carts became rigs, reachable by any of them. Calling it
   *  directly is the point: it is the seam where a bot could write the player's counters. */
  function resolveShotFor(s: Sim, cart: Cart): void {
    (s as unknown as { resolveShot: (c: Cart) => void }).resolveShot(cart);
  }

  it("a bot's shot never launches the player's course ball or counts a player stroke", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    // The stationary branch is dormant -- no input path reaches it -- so reach in and select it
    // directly. Its player-only guard is what keeps that reference implementation safe to revive.
    sim.mode = SwingMode.Stationary;
    const bot = sim.bots[0]!;
    const from = { ...sim.current.position };

    expect(bot.fire(1)).toBe(true);
    resolveShotFor(sim, bot);

    expect(sim.strokes).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    // A full-charge launch would carry the course ball tens of metres in half a second; a ball
    // left alone only settles.
    for (let i = 0; i < 30; i++) sim.step();
    const p = sim.current.position;
    expect(Math.hypot(p.x - from.x, p.z - from.z)).toBeLessThan(2);
  });

  it("a bot's cart-mode shot spawns its own pooled ball without counting a player shot", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    const ammoBefore = bot.ammo;

    expect(bot.fire(1)).toBe(true);
    resolveShotFor(sim, bot);

    // `stats` and `lastShotWasStrike` are the player's round-level state, not the world's.
    expect(sim.stats.shotsFired).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);

    // The bot's own shot still has to happen -- guarding the player's counters must not turn a
    // bot's trigger pull into a no-op.
    expect(bot.ammo).toBe(ammoBefore - 1);
    const pool = (sim as unknown as { ballPool: BallPool }).ballPool;
    const balls = (pool as unknown as { balls: PooledBall[] }).balls;
    expect(balls.some((b) => b.state !== "idle")).toBe(true);
  });

  it("returns every bot to its spawn on reset", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    bot.position.x = 0;
    bot.position.z = 0;
    bot.strokesTaken = 3;
    bot.health.hp = 1;

    sim.reset();

    expect(bot.position.x).toBeCloseTo(sim.terrain.cupPosition.x + 2.5, 5);
    expect(bot.strokesTaken).toBe(0);
    expect(bot.health.hp).toBe(bot.health.max);
  });

  it("stays put while the player is out of its engagement range", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    const start = { x: bot.position.x, z: bot.position.z };
    for (let i = 0; i < 300; i++) sim.step();
    expect(Math.hypot(bot.position.x - start.x, bot.position.z - start.z)).toBeLessThan(1);
    expect(bot.ammo).toBe(STARTING_AMMO);
  });

  it("closes on the player and spends ammo once the player is in range", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    // Put the player just inside the bot's engagement range rather than driving there, so the
    // assertion is about the bot rather than about the terrain between the tee and the cup.
    sim.cart.position.x = bot.position.x - 20;
    sim.cart.position.z = bot.position.z;
    const ammoBefore = bot.ammo;
    const distanceBefore = 20;

    for (let i = 0; i < 600; i++) sim.step();

    const distanceAfter = Math.hypot(
      bot.position.x - sim.cart.position.x,
      bot.position.z - sim.cart.position.z,
    );
    expect(distanceAfter).toBeLessThan(distanceBefore);
    expect(bot.ammo).toBeLessThan(ammoBefore);
  });

  it("holds fire at a dead player instead of camping the respawn", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    sim.cart.position.x = bot.position.x - 15;
    sim.cart.position.z = bot.position.z;
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.cart);
    const ammoBefore = bot.ammo;

    // Shorter than RESPAWN_DELAY_S, so the player is dead for the whole window.
    for (let i = 0; i < seconds(RESPAWN_DELAY_S - 0.5); i++) sim.step();

    expect(bot.ammo).toBe(ammoBefore);
  });

  it("plays the same match twice from the same seed", async () => {
    const trace = async (): Promise<number[]> => {
      const sim = await Sim.create(fixedHoleSpec());
      sim.cart.position.x = sim.bots[0]!.position.x - 20;
      sim.cart.position.z = sim.bots[0]!.position.z;
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        sim.step();
        out.push(sim.bots[0]!.turretYaw);
      }
      return out;
    };
    expect(await trace()).toEqual(await trace());
  });

  /**
   * `CartRig.random` is private; reaching in here is the only way to observe the reseed
   * directly rather than through however many ticks of physics it takes a bot to draw from it.
   * Physics is the wrong instrument for this test: two `RAPIER.World`s with different
   * step-count histories are not bound to bit-identical floating point from identical body
   * positions, so a full post-reset turretYaw trace compared against a freshly created sim's
   * trace diverges on its own, tens of ticks before either bot's first random draw -- confirmed
   * by instrumenting `rig.random` to log its call ticks, which showed the two traces splitting
   * at tick 72 while the first actual draw did not happen until tick ~300 in either run. That
   * divergence has nothing to do with seeding and would fail this test under correct code, so a
   * direct comparison of the streams themselves is what actually isolates the reseed.
   */
  function botRandom(sim: Sim, rigIndex: number): () => number {
    const rig = (sim as unknown as { rigs: { random: (() => number) | null }[] }).rigs[rigIndex]!;
    if (rig.random === null) throw new Error("rig has no RNG stream");
    return rig.random;
  }

  it("reseeds the bot's RNG on reset to the same stream a fresh sim would construct", async () => {
    const replayed = await Sim.create(fixedHoleSpec());
    // Draw from the stream directly rather than hoping gameplay reaches a release tick within
    // some fixed number of ticks -- the bot's only random() call site is the charge-threshold
    // release, whose timing depends on aim-lock and charge-up duration and is not something a
    // fixed tick count can be relied on to hit. Advancing the stream this way also means a
    // reset() that dropped its re-seed entirely (left the same never-reseeded closure in place)
    // would continue mid-stream after reset and diverge from a fresh sim's first draw, rather
    // than coincidentally matching it by both happening to still be at their own start.
    const preReset = botRandom(replayed, 1);
    preReset();
    preReset();
    preReset();
    replayed.reset();

    const fresh = await Sim.create(fixedHoleSpec());

    const afterReset = [botRandom(replayed, 1)(), botRandom(replayed, 1)(), botRandom(replayed, 1)()];
    const freshDraws = [botRandom(fresh, 1)(), botRandom(fresh, 1)(), botRandom(fresh, 1)()];
    expect(afterReset).toEqual(freshDraws);
  });
});

describe("driving into water", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  /** Find a water cell on this hole -- the fixed hole has one but do not assume where. */
  function findWater(s: Sim): { x: number; z: number } {
    const half = s.terrain.spec.fieldSize / 2 - 4;
    for (let x = -half; x <= half; x += 2) {
      for (let z = -half; z <= half; z += 2) {
        if (s.surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
      }
    }
    throw new Error(`no water cell found scanning [-${half}, ${half}] step 2 on both axes`);
  }

  it("costs exactly one stroke and one point of health on the tick it enters", () => {
    const water = findWater(sim);

    // Settle first, so the cart has a last-safe position recorded on dry land.
    play(sim, [{ ticks: 30, intent: {} }]);
    const hpBefore = sim.cart.health.hp;

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(1);
    expect(sim.cart.health.hp).toBe(hpBefore - 1);
  });

  it("does not drain a stroke every tick while it sits there", () => {
    const water = findWater(sim);
    play(sim, [{ ticks: 30, intent: {} }]);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();
    const afterFirst = sim.cart.strokesTaken;

    // Put it straight back in; the edge only re-arms once the cart is out of the water.
    for (let i = 0; i < 10; i++) {
      sim.cart.position.x = water.x;
      sim.cart.position.z = water.z;
      sim.step();
    }
    expect(sim.cart.strokesTaken).toBe(afterFirst);
  });

  it("drops the cart back on the last dry ground it stood on", () => {
    const water = findWater(sim);
    play(sim, [{ ticks: 30, intent: {} }]);
    const dry = { x: sim.cart.position.x, z: sim.cart.position.z };

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.position.x).toBeCloseTo(dry.x, 3);
    expect(sim.cart.position.z).toBeCloseTo(dry.z, 3);
    expect(sim.surfaces.surfaceAt(sim.cart.position.x, sim.cart.position.z)).not.toBe(
      SurfaceId.Water,
    );
  });

  it("does not fire while the cart is dead and awaiting respawn", () => {
    const water = findWater(sim);
    play(sim, [{ ticks: 30, intent: {} }]);
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.cart);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(0);
  });
});

describe("the match clock", () => {
  it("counts down from the default duration", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    expect(sim.matchTimeRemaining).toBe(MATCH_DURATION_S);
    expect(sim.matchOver).toBe(false);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.matchTimeRemaining).toBeCloseTo(MATCH_DURATION_S - 1, 5);
  });

  it("runs to the end in a handful of ticks when a test shortens it", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0, matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchTimeRemaining).toBe(0);
    expect(sim.matchOver).toBe(true);
  });

  it("freezes the world once the match is over", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    const frozen = { ...sim.cart.position };
    const botFrozen = { ...sim.bots[0]!.position };

    const intent = neutralIntent();
    intent.throttle = 1;
    for (let i = 0; i < 120; i++) sim.step(intent);

    expect(sim.cart.position.x).toBeCloseTo(frozen.x, 9);
    expect(sim.cart.position.z).toBeCloseTo(frozen.z, 9);
    expect(sim.bots[0]!.position.x).toBeCloseTo(botFrozen.x, 9);
  });

  it("collapses the render-interpolation pairs on the buzzer tick, not just the live carts", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOver).toBe(true);

    // The renderer never reads `sim.cart` -- it lerps `previousCart` -> `currentCart` (and the
    // ball's `previous` -> `current`) by an alpha that keeps sweeping 0..1 every tick period even
    // though `step()` is now a no-op. If those pairs are left one tick apart from whenever the
    // buzzer happened to land, a moving cart or ball visibly oscillates forever after the match
    // has "ended". Equal components is what a frozen render actually requires.
    expect(sim.previousCart.position.x).toBe(sim.currentCart.position.x);
    expect(sim.previousCart.position.z).toBe(sim.currentCart.position.z);
    expect(sim.previousCart.heading).toBe(sim.currentCart.heading);
    expect(sim.previousBotCarts[0]!.position.x).toBe(sim.currentBotCarts[0]!.position.x);
    expect(sim.previousBotCarts[0]!.position.z).toBe(sim.currentBotCarts[0]!.position.z);
    expect(sim.previous.position.x).toBe(sim.current.position.x);
    expect(sim.previous.position.y).toBe(sim.current.position.y);
    expect(sim.previous.position.z).toBe(sim.current.position.z);

    // And that equality must survive further ticks, not just hold by luck on the buzzer tick
    // itself -- step() is a no-op from here on, so the pairs must stay collapsed indefinitely.
    const intent = neutralIntent();
    intent.throttle = 1;
    for (let i = 0; i < 30; i++) sim.step(intent);
    expect(sim.previousCart.position.x).toBe(sim.currentCart.position.x);
    expect(sim.previous.position.x).toBe(sim.current.position.x);
  });

  it("is pending until the clock runs out", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    expect(sim.matchOutcome()).toBe("pending");
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("draw");
  });

  it("gives the win to whoever took fewer strokes", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.bots[0]!.strokesTaken = 3;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("player");
  });

  it("exposes the best bot score as the single source matchOutcome and the results overlay both read", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.bots[0]!.strokesTaken = 3;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.bestBotStrokes()).toBe(3);
  });

  it("gives the win to the bot when the player took more", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.cart.strokesTaken = 4;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("bot");
  });

  it("calls an equal score a draw rather than picking a winner", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.cart.strokesTaken = 2;
    sim.bots[0]!.strokesTaken = 2;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("draw");
  });

  it("keeps the score a cart died on: a death before the closing tick still counts", async () => {
    // matchDurationS is 5/60, so the buzzer fires on the 5th step() (the tick where
    // matchTimeRemaining first falls to <= half a tick). That tick's early return -- correctly,
    // per the freeze fix above -- never touches a cart, so killing the bot beforehand and only
    // then taking the *last* step (as this test originally did after 4 pre-steps) never runs a
    // single real tick over the dead bot: no respawn-timer tick, nothing on the death path at
    // all. Killing after 3 steps instead leaves two real ticks (the 4th and 5th) to run before
    // the clock closes -- the 4th is a genuine, non-early-return tick that processes the death
    // (stepRespawn counts the timer down), and only the 5th ends the match.
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 3; i++) sim.step();
    sim.bots[0]!.strokesTaken = 6;
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.bots[0]!);

    sim.step();
    expect(sim.matchOver).toBe(false); // the 4th tick is real, not the early return
    expect(sim.bots[0]!.dead).toBe(true); // and it did land on the dead cart

    sim.step();
    expect(sim.matchOver).toBe(true);
    expect(sim.bots[0]!.strokesTaken).toBe(6);
    expect(sim.matchOutcome()).toBe("player");
  });

  it("reset re-rolls the clock and clears the result", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOver).toBe(true);

    sim.reset();

    expect(sim.matchOver).toBe(false);
    expect(sim.matchTimeRemaining).toBeCloseTo(5 / 60, 9);
    expect(sim.matchOutcome()).toBe("pending");
  });
});
