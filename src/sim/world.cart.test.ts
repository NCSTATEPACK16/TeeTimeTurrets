import { beforeEach, describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { CART_COLLIDER, RESPAWN_DELAY_S, STARTING_AMMO } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { BallPool, PooledBall } from "./entities/BallPool";
import type { Bucket } from "./entities/Pickup";
import { SurfaceId } from "./surfaces";
import { Sim, SwingMode } from "./world";

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

/** Drive to cart mode first -- every cart script needs it, and it is one press. */
const ENTER_CART_MODE: ScriptedStep = { ticks: 1, intent: { toggleMode: true } };

/** Full-charge shot with whatever club is equipped, measured as displacement from the tee. */
function fullShotDistance(sim: Sim): number {
  const from = { ...sim.current.position };
  play(sim, [{ ticks: seconds(2), intent: { fire: true } }, { ticks: 2, intent: {} }]);
  play(sim, [{ ticks: seconds(8), intent: {} }]);
  const p = sim.current.position;
  return Math.hypot(p.x - from.x, p.z - from.z);
}

describe("cart in the world", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("starts in stationary mode and toggles to cart mode on the mode key", () => {
    expect(sim.mode).toBe(SwingMode.Stationary);
    play(sim, [ENTER_CART_MODE]);
    expect(sim.mode).toBe(SwingMode.Cart);
    play(sim, [{ ticks: 1, intent: { toggleMode: true } }]);
    expect(sim.mode).toBe(SwingMode.Stationary);
  });

  it("spawns the cart resting on the terrain rather than inside or above it", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: {} }]);
    const p = sim.cart.position;
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z));
    expect(p.y - sim.terrain.heightAt(p.x, p.z)).toBeLessThan(2);
  });

  it("drives forward under throttle without falling through the ground", () => {
    const start = { ...sim.cart.position };
    play(sim, [ENTER_CART_MODE, { ticks: seconds(3), intent: { throttle: 1 } }]);
    const p = sim.cart.position;

    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    // The tunneling check the AGENTS.md testing invariants ask for, applied to the cart:
    // a body that fell through the heightfield diverges downward instead of tracking it.
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z) - 0.5);
  });

  it("steers the chassis while driving", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1, steer: 1 } }]);
    expect(Math.abs(sim.cart.heading)).toBeGreaterThan(0.3);
  });

  it("stays on the field when driven at the edge for a long time", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(30), intent: { throttle: -1 } }]);
    const p = sim.cart.position;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("holds an aim offset relative to the chassis rather than an absolute world yaw", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: { throttle: 1, steer: 1, aimDelta: -0.01 } }]);
    expect(sim.cart.turretOffset).toBeLessThan(0);
    expect(sim.cart.heading).toBeGreaterThan(0);
    expect(sim.cart.turretYaw).toBeCloseTo(sim.cart.heading + sim.cart.turretOffset, 9);
  });

  it("fires straight over the bonnet when the player never touches the aim control", () => {
    // Aiming is optional: drive, point the cart, shoot. The turret only leaves the chassis
    // heading if the player asks it to.
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1, steer: -0.6 } }]);
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
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);

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
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);

    const pool = (sim as unknown as { ballPool: BallPool }).ballPool;
    const balls = (pool as unknown as { balls: PooledBall[] }).balls;
    for (const b of balls) b.state = "flying";
    expect(pool.acquire()).toBeNull();

    const next: HoleSpec = { ...fixedHoleSpec(), seed: 777, tee: { x: -10, z: 40 } };
    sim.loadHole(next);

    // loadHole() does not reset `mode`, so the sim is still in cart mode from the toggle above.
    expect(sim.mode).toBe(SwingMode.Cart);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.lastShotWasStrike).toBe(true);
  });
});

describe("striking the ball from the cart", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("fires regardless of distance in stationary mode, where the player stands at the ball", () => {
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.mode).toBe(SwingMode.Stationary);
    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.strokes).toBe(1);
  });

  it("blocks a second shot until the fired club's reload elapses", () => {
    play(sim, [
      { ticks: seconds(1.5), intent: { fire: true } },
      { ticks: 2, intent: {} },
      { ticks: seconds(0.2), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);
    expect(sim.strokes).toBe(1);
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

    expect(putterDistance).toBeLessThan(driverDistance * 0.6);
  });

  it("drives the whole gate through the input interface with no direct Sim calls", () => {
    // Meta-check: one script covering mode, club, drive, aim and fire, asserting the sim ends
    // somewhere sane. If this ever needs a direct method call to work, the interface is wrong.
    const source = new ScriptedInputSource([
      { ticks: 1, intent: { toggleMode: true } },
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
    expect(sim.mode).toBe(SwingMode.Cart);
    expect(sim.cart.equippedClub).toBe(ClubType.Iron);
    expect(Number.isFinite(sim.cart.position.y)).toBe(true);
    expect(Number.isFinite(sim.current.position.y)).toBe(true);
  });
});

describe("cart-mode ammo-aware combat shots", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  it("a fire with ammo spawns a pooled ball at the muzzle and it flies", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    expect(sim.cart.ammo).toBeGreaterThan(0);
    const ammoBefore = sim.cart.ammo;

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.lastShotWasStrike).toBe(true);
  });

  it("firing at 0 ammo produces a recoil-only blank: no strike, ammo stays at 0", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    sim.cart.ammo = 0;
    const recoilBefore = { x: sim.cart.recoil.x, z: sim.cart.recoil.z };

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    expect(sim.cart.recoil.x).not.toBeCloseTo(recoilBefore.x, 9);
  });

  it("does not touch stationary mode's stroke count or ball state", () => {
    expect(sim.mode).toBe(SwingMode.Stationary);
    const strokesBefore = sim.strokes;
    const ammoBefore = sim.cart.ammo;
    expect(ammoBefore).toBe(STARTING_AMMO);

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    // Cart.fire() runs off the one shared swing state machine regardless of Sim.mode -- that is
    // by design, so charge/reload/ammo cannot drift between modes -- so ammo still ticks down
    // here even though the shot itself is resolved by stationary mode's own path. What this
    // guards is narrower: that stationary mode's stroke/ball bookkeeping is driven only by its
    // own resting/holedOut rules, untouched by the cart-mode ammo/pool/bucket wiring that now
    // also runs unconditionally inside stepCart every tick.
    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.strokes).toBe(strokesBefore + (sim.lastShotWasStrike ? 1 : 0));
  });

  it("driving over the dormant course ball costs nothing", () => {
    // The course ball rests at the tee and the cart spawns behind it, so this is the drive every
    // hole opens with. It is a hazard only if the dormant ball is a combat actor.
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
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
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: { selectClub: ClubType.Putter } }]);

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
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);

    sim.cart.ammo = 0;
    play(sim, [{ ticks: seconds(3), intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);
  });

  it("a death freezes the cart for the respawn delay without charging its own stroke", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: { throttle: 1 } }]);
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
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1 } }]);
    kill(sim);
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S + 0.5), intent: {} }]);

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
    expect(sim.cart.position.x).toBeCloseTo(sim.terrain.teePosition.x - 2.5, 5);
    expect(sim.cart.position.z).toBeCloseTo(sim.terrain.teePosition.z, 5);
  });

  it("only one death per life: a second kill while dead does not restart the respawn timer", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    kill(sim);
    play(sim, [{ ticks: seconds(1), intent: {} }]);
    const timer = sim.cart.respawnTimer;
    expect(timer).toBeLessThan(RESPAWN_DELAY_S);

    kill(sim);
    expect(sim.cart.respawnTimer).toBeCloseTo(timer, 9);
  });

  it("reset() heals a mid-respawn cart and stands every target back up", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
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
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
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
    // Stationary is still the default mode, so this is the branch a bot would reach today.
    expect(sim.mode).toBe(SwingMode.Stationary);
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
    sim.mode = SwingMode.Cart;
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
});

describe("driving into water", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  /** Find a water cell on this hole, or skip -- the fixed hole has one but do not assume where. */
  function findWater(s: Sim): { x: number; z: number } | null {
    const half = s.terrain.spec.fieldSize / 2 - 4;
    for (let x = -half; x <= half; x += 2) {
      for (let z = -half; z <= half; z += 2) {
        if (s.surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
      }
    }
    return null;
  }

  it("costs exactly one stroke and one point of health on the tick it enters", () => {
    const water = findWater(sim);
    expect(water).not.toBeNull();

    // Settle first, so the cart has a last-safe position recorded on dry land.
    play(sim, [{ ticks: 30, intent: {} }]);
    const hpBefore = sim.cart.health.hp;

    sim.cart.position.x = water!.x;
    sim.cart.position.z = water!.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(1);
    expect(sim.cart.health.hp).toBe(hpBefore - 1);
  });

  it("does not drain a stroke every tick while it sits there", () => {
    const water = findWater(sim)!;
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
    const water = findWater(sim)!;
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
    const water = findWater(sim)!;
    play(sim, [{ ticks: 30, intent: {} }]);
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.cart);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(0);
  });
});
