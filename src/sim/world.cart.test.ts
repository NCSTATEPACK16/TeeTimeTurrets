import { beforeEach, describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { BOT_ENGAGE_RANGE, BOT_FIRE_RANGE, createBotMind } from "./bot";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER, RESPAWN_DELAY_S, STARTING_AMMO } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { POOL_SIZE } from "./entities/BallPool";
import type { BallPool, PooledBall } from "./entities/BallPool";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import { SurfaceId } from "./surfaces";
import { DECK_HALF_WIDTH, DECK_SHOULDER_RUN, deriveCrossings } from "./crossing";
import type { Crossing } from "./crossing";
import { MATCH_DURATION_S, POOL_TRANSFORM_STRIDE, Sim } from "./world";
import { neutralIntent } from "./intent";

/** A match on one hole: its own field, the player on the tee, a bot (if any) on the cup. */
function holeSim(spec: HoleSpec = fixedHoleSpec(), botCount = 1, matchDurationS?: number): Promise<Sim> {
  return Sim.create(arenaFromHole(spec), { botCount, matchDurationS });
}

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
 * released back to the pool once it lands, so its final resting place is not readable.
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
    sim = await holeSim(fixedHoleSpec(), 0);
  });

  it("spawns the cart resting on the terrain rather than inside or above it", () => {
    play(sim, [{ ticks: seconds(1), intent: {} }]);
    const p = sim.cart.position;
    expect(p.y).toBeGreaterThan(sim.heightAt(p.x, p.z));
    expect(p.y - sim.heightAt(p.x, p.z)).toBeLessThan(2);
  });

  it("drives forward under throttle without falling through the ground", () => {
    const start = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(3), intent: { throttle: 1 } }]);
    const p = sim.cart.position;

    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    // The tunneling check the AGENTS.md testing invariants ask for, applied to the cart:
    // a body that fell through the heightfield diverges downward instead of tracking it.
    expect(p.y).toBeGreaterThan(sim.heightAt(p.x, p.z) - 0.5);
  });

  it("steers the chassis while driving", () => {
    play(sim, [{ ticks: seconds(2), intent: { throttle: 1, steer: 1 } }]);
    expect(Math.abs(sim.cart.heading)).toBeGreaterThan(0.3);
  });

  it("stays on the field when driven at the edge for a long time", () => {
    play(sim, [{ ticks: seconds(30), intent: { throttle: -1 } }]);
    const p = sim.cart.position;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.bounds.maxX);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.bounds.maxZ);
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

  it("stands on the ground and materials of the arena it was created with", () => {
    expect(sim.bounds).toEqual({ minX: -80, minZ: -80, maxX: 80, maxZ: 80 });
    const cup = fixedHoleSpec().cup;
    expect(sim.surfaces.surfaceAt(cup.x, cup.z)).toBe(SurfaceId.Green);
  });

  it("deals the player onto the tee, facing the cup", () => {
    const { tee, cup } = fixedHoleSpec();
    expect(sim.cart.position.x).toBeCloseTo(tee.x, 5);
    expect(sim.cart.position.z).toBeCloseTo(tee.z, 5);
    expect(sim.cart.heading).toBeCloseTo(Math.atan2(cup.z - tee.z, cup.x - tee.x), 9);
  });

});

describe("striking the ball from the cart", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await holeSim(fixedHoleSpec(), 0);
  });

  it("equips the club the player selects and uses its stats for the shot", async () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Iron } }]);
    expect(sim.cart.equippedClub).toBe(ClubType.Iron);

    // Compared against the putter (the club a cart starts with) on an identical course rather than
    // against a magic number: what needs proving is that selection reaches Ballistics at all, and
    // relative distance shows it. If selecting the iron did nothing, both shots would be putts.
    const ironDistance = fullShotDistance(sim);
    const putterSim = await holeSim(fixedHoleSpec(), 0);
    play(putterSim, [{ ticks: 1, intent: { selectClub: ClubType.Putter } }]);
    const putterDistance = fullShotDistance(putterSim);

    // Guard the asymmetric trivial pass: an iron shot that silently spawns no ball at all --
    // out of ammo, pool exhausted, a regression in the fire gate -- measures 0, and 0 is less
    // than any putter distance. The comparison alone would call that a pass.
    expect(ironDistance).toBeGreaterThan(0);
    expect(ironDistance).toBeLessThan(putterDistance * 0.6);
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
  });
});

describe("cart-mode ammo-aware combat shots", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await holeSim(fixedHoleSpec(), 0);
  });

  it("a fire with ammo spawns a pooled ball at the muzzle and it flies", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    expect(sim.cart.ammo).toBeGreaterThan(0);
    const ammoBefore = sim.cart.ammo;

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.lastShotWasStrike).toBe(true);
  });

  it("firing at 0 ammo is a blank: no strike, no kick, ammo stays at 0", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    sim.cart.ammo = 0;

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    expect(Math.hypot(sim.cart.recoil.x, sim.cart.recoil.z)).toBe(0);
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

});

describe("damage and respawn", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await holeSim(fixedHoleSpec(), 0);
  });

  /** The private hook combat.ts calls on a kill. Driving HP to zero through a real contact is
   * combat.test.ts's job; what this suite owns is what the *world* does about a death. */
  function kill(s: Sim): void {
    (s as unknown as { killCart: (cart: Cart, victim: number, killer: number) => void }).killCart(s.cart, 0, -1);
  }

  it("counts a shot that spawned a ball, and does not count a blank", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);

    sim.cart.ammo = 0;
    play(sim, [{ ticks: seconds(3), intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);
  });

  it("a death is one stroke, and freezes the cart for the respawn delay", () => {
    play(sim, [{ ticks: seconds(1), intent: { throttle: 1 } }]);
    const ammoBefore = sim.cart.ammo;

    kill(sim);
    expect(sim.cart.dead).toBe(true);
    expect(sim.match.strokesFor(0)).toBe(1);

    const frozen = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S - 0.5), intent: { throttle: 1, fire: true } }]);

    expect(sim.cart.dead).toBe(true);
    expect(sim.cart.position.x).toBeCloseTo(frozen.x, 9);
    expect(sim.cart.position.z).toBeCloseTo(frozen.z, 9);
    expect(sim.cart.ammo).toBe(ammoBefore);
  });

  it("respawns on a spawn point at full health once the delay elapses", () => {
    play(sim, [{ ticks: seconds(2), intent: { throttle: 1 } }]);
    kill(sim);
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S + 0.5), intent: {} }]);

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
    // A one-hole arena has two spawn points: the tee and the cup. Standing on one of them, not
    // wherever it died.
    const { tee, cup } = fixedHoleSpec();
    const p = sim.cart.position;
    const onSpawn = [tee, cup].some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 0.5);
    expect(onSpawn, `respawned at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(true);
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

  it("reset() heals a mid-respawn cart and clears the scoreboard", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    kill(sim);
    expect(sim.cart.dead).toBe(true);
    expect(sim.match.strokesFor(0)).toBe(1);

    sim.reset();

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.respawnTimer).toBe(0);
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
    expect(sim.match.strokesFor(0)).toBe(0);
  });

  it("keeps the player's shot stats across reset()", () => {
    play(sim, [{ ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.stats.shotsFired).toBe(1);

    sim.reset();
    expect(sim.stats.shotsFired).toBe(1);
  });

});

describe("a rematch", () => {
  interface Leftovers {
    simTime: number;
    ballPool: BallPool;
    rigs: { mind: { stuckFor: number; hasAmmoTarget: boolean; skill: number } | null }[];
  }

  it("reset() clears what the last match left on the ground and in every cart's hands", async () => {
    const sim = await holeSim(fixedHoleSpec(), 1);
    const inside = sim as unknown as Leftovers;
    const skill = inside.rigs[1]!.mind!.skill;

    // Leave something of each kind behind: balls in the air and on the ground, the bucket taken,
    // the clock run on, a bot that thinks it is stuck and knows where ammo is, and carts with a
    // swapped club, a spent magazine and a shot charging.
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: seconds(4), intent: {} }]);
    const bucket = sim.pickups[0]!;
    bucket.cooldownRemaining = 45;
    const mind = inside.rigs[1]!.mind!;
    mind.stuckFor = 1.5;
    mind.hasAmmoTarget = true;
    for (const cart of [sim.cart, ...sim.bots]) {
      cart.selectClub(ClubType.Iron);
      cart.ammo = 3;
    }
    play(sim, [{ ticks: 10, intent: { fire: true } }]);
    expect(inside.ballPool.all.some((b) => b.state !== "idle")).toBe(true);
    expect(sim.cart.charge).toBeGreaterThan(0);

    sim.reset();

    expect(inside.ballPool.all.every((b) => b.state === "idle")).toBe(true);
    expect(bucket.cooldownRemaining).toBe(0);
    expect(inside.simTime).toBe(0);
    expect(inside.rigs[1]!.mind).toEqual(createBotMind(skill));
    const fresh = await holeSim(fixedHoleSpec(), 1);
    for (const [i, cart] of [sim.cart, ...sim.bots].entries()) {
      const want = [fresh.cart, ...fresh.bots][i]!;
      expect(cart.equippedClub).toBe(want.equippedClub);
      expect(cart.ammo).toBe(STARTING_AMMO);
      expect(cart.charge).toBe(0);
    }
    fresh.dispose();
  });
});

describe("bot carts", () => {
  it("creates one bot by default, on the terrain at the far end of the hole", async () => {
    const sim = await holeSim();
    expect(sim.bots).toHaveLength(1);

    const bot = sim.bots[0]!;
    const { cup } = fixedHoleSpec();
    expect(bot.position.x).toBeCloseTo(cup.x, 5);
    expect(bot.position.z).toBeCloseTo(cup.z, 5);
    expect(bot.position.y).toBeGreaterThan(sim.heightAt(bot.position.x, bot.position.z));
  });

  it("creates none when the caller asks for none", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    expect(sim.bots).toHaveLength(0);
    expect(sim.currentBotCarts).toHaveLength(0);
  });

  it("gives every bot its own full arena health bar", async () => {
    const sim = await holeSim();
    expect(sim.bots[0]!.health.max).toBe(ARENA_MAX_HEALTH);
    expect(sim.bots[0]!.health.hp).toBe(sim.bots[0]!.health.max);
  });

  it("publishes a render transform per bot and keeps it in step with the sim", async () => {
    const sim = await holeSim();
    expect(sim.currentBotCarts).toHaveLength(1);
    expect(sim.previousBotCarts).toHaveLength(1);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.currentBotCarts[0]!.position.x).toBeCloseTo(sim.bots[0]!.position.x, 9);
    expect(sim.currentBotCarts[0]!.position.z).toBeCloseTo(sim.bots[0]!.position.z, 9);
  });

  it("settles the bot onto the ground rather than leaving it hanging or sunk", async () => {
    const sim = await holeSim();
    for (let i = 0; i < 120; i++) sim.step();
    const bot = sim.bots[0]!;
    const ground = sim.heightAt(bot.position.x, bot.position.z);
    expect(bot.position.y - ground).toBeGreaterThan(0);
    expect(bot.position.y - ground).toBeLessThan(2);
  });

  /** `resolveShot` is private and, since carts became rigs, reachable by any of them. Calling it
   *  directly is the point: it is the seam where a bot could write the player's counters.
   *
   *  It takes the rig rather than the cart as of Stage C -- the rig is what knows the index a
   *  fired ball is attributed to -- so the cart is looked up here rather than at every caller. */
  function resolveShotFor(s: Sim, cart: Cart): void {
    const rigs = (s as unknown as { rigs: { cart: Cart }[] }).rigs;
    const rig = rigs.find((r) => r.cart === cart);
    expect(rig).toBeDefined();
    (s as unknown as { resolveShot: (r: unknown) => void }).resolveShot(rig);
  }

  it("a bot's cart-mode shot spawns its own pooled ball without counting a player shot", async () => {
    const sim = await holeSim();
    const bot = sim.bots[0]!;
    const ammoBefore = bot.ammo;

    expect(bot.fire(1)).toBe(true);
    resolveShotFor(sim, bot);

    // `stats` and `lastShotWasStrike` are the player's state, not the world's.
    expect(sim.stats.shotsFired).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);

    // The bot's own shot still has to happen -- guarding the player's counters must not turn a
    // bot's trigger pull into a no-op.
    expect(bot.ammo).toBe(ammoBefore - 1);
    const pool = (sim as unknown as { ballPool: BallPool }).ballPool;
    const balls = (pool as unknown as { balls: PooledBall[] }).balls;
    const flying = balls.filter((b) => b.state !== "idle");
    expect(flying).toHaveLength(1);
    // And the ball it spawned belongs to the bot, not to the player. `sim.bots[0]` is rig 1;
    // the whole of arena's scoring rests on that number being right at the point of the shot,
    // and 0 -- the value every ball carried before Stage C -- is the wrong answer that looks
    // like a plausible default.
    expect(flying[0]!.firedBy).toBe(1);
  });

  it("returns every bot to its spawn on reset", async () => {
    const sim = await holeSim();
    const bot = sim.bots[0]!;
    bot.position.x = 0;
    bot.position.z = 0;
    bot.health.hp = 1;

    sim.reset();

    expect(bot.position.x).toBeCloseTo(fixedHoleSpec().cup.x, 5);
    expect(bot.health.hp).toBe(bot.health.max);
  });

  it("closes on the player while out of range, and holds its fire the whole way", async () => {
    /**
     * This asserted "stays put" until the authored routing landed. It was the integration half of
     * `bot.test.ts`'s idle-outside-range rule, and that rule made every bot in an arena match stand
     * still for the whole match once carts were dealt one to a hole -- the closest two tees on the
     * course are 74 m apart against a 40 m engagement range.
     *
     * What survives the change is the half that still holds: the weapon is a 40 m weapon, so the
     * bot closes the distance without spending a round doing it.
     */
    const sim = await holeSim();
    const bot = sim.bots[0]!;
    const start = { x: bot.position.x, z: bot.position.z };
    const startDistance = Math.hypot(start.x - sim.cart.position.x, start.z - sim.cart.position.z);
    expect(startDistance, "the bot has to start out of range or this proves nothing").toBeGreaterThan(
      BOT_ENGAGE_RANGE,
    );

    // Two and a half seconds: the bot opens on the cup, ~90 m out, and at 20 m/s reaches 40 m a
    // little after three.
    for (let i = 0; i < 150; i++) sim.step();

    const moved = Math.hypot(bot.position.x - start.x, bot.position.z - start.z);
    expect(moved, "the bot did not move at all").toBeGreaterThan(1);
    const endDistance = Math.hypot(
      bot.position.x - sim.cart.position.x,
      bot.position.z - sim.cart.position.z,
    );
    expect(endDistance, "it moved, but not toward the player").toBeLessThan(startDistance - 1);
    // Still out of range, so every tick above was a held-fire tick.
    expect(endDistance).toBeGreaterThan(BOT_ENGAGE_RANGE);
    expect(bot.ammo).toBe(STARTING_AMMO);
  });

  it("closes on the player and spends ammo once the player is in range", async () => {
    const sim = await holeSim();
    const bot = sim.bots[0]!;
    // Put the player just inside the bot's engagement range rather than driving there, so the
    // assertion is about the bot rather than about the terrain between the tee and the cup.
    sim.cart.position.x = bot.position.x - 20;
    sim.cart.position.z = bot.position.z;
    const ammoBefore = bot.ammo;

    // The bot fires the putter, a short-range club, so it drives right in. It is effective enough
    // to kill the player, who then respawns across the hole -- so the final distance measures the
    // respawn, not the approach. What closing proves is that the bot reached firing range at all,
    // which is the nearest it got over the run.
    // The lowest ammo seen, not the final count: a fired ball that lands near the bot is picked back
    // up, so the net can return to where it started even though the bot emptied rounds into the player.
    let nearest = Infinity;
    let fewestRounds = ammoBefore;
    for (let i = 0; i < 600; i++) {
      sim.step();
      nearest = Math.min(
        nearest,
        Math.hypot(bot.position.x - sim.cart.position.x, bot.position.z - sim.cart.position.z),
      );
      fewestRounds = Math.min(fewestRounds, bot.ammo);
    }

    expect(nearest, "the bot never closed into firing range").toBeLessThanOrEqual(BOT_FIRE_RANGE);
    expect(fewestRounds).toBeLessThan(ammoBefore);
  });

  it("holds fire at a dead player instead of camping the respawn", async () => {
    const sim = await holeSim();
    const bot = sim.bots[0]!;
    sim.cart.position.x = bot.position.x - 15;
    sim.cart.position.z = bot.position.z;
    (sim as unknown as { killCart: (cart: Cart, victim: number, killer: number) => void }).killCart(sim.cart, 0, -1);
    const ammoBefore = bot.ammo;

    // Shorter than RESPAWN_DELAY_S, so the player is dead for the whole window.
    for (let i = 0; i < seconds(RESPAWN_DELAY_S - 0.5); i++) sim.step();

    expect(bot.ammo).toBe(ammoBefore);
  });

  it("plays the same match twice from the same seed", async () => {
    const trace = async (): Promise<number[]> => {
      const sim = await holeSim();
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
   * (Since Stage 1, `reset()` rebuilds the physics world, so the divergence described next no
   * longer happens after a reset; `arenaGolden.test.ts`'s rematch check is the whole-match proof.
   * This stays the direct check on the stream.)
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
    const replayed = await holeSim();
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

    const fresh = await holeSim();

    const afterReset = [botRandom(replayed, 1)(), botRandom(replayed, 1)(), botRandom(replayed, 1)()];
    const freshDraws = [botRandom(fresh, 1)(), botRandom(fresh, 1)(), botRandom(fresh, 1)()];
    expect(afterReset).toEqual(freshDraws);
  });
});

describe("driving into water", () => {
  let sim: Sim;

  /**
   * The fixture with a pond added. Since Tier 2 (docs/COURSE_PIPELINE.md §5) water is placed
   * rather than inherited from terrain height, and `fixedHoleSpec()` is deliberately dry -- so a
   * physics regression is never confused with a hazard landing under the ball. These tests are
   * about what happens when a cart *is* in water, so they need a hole that has some.
   *
   * Sited north of the corridor: the fixture runs tee (-45, 0) to cup (45, 8) with its dog-leg
   * apex at (0, -25), so a pond at z in [30, 60] is clear of the mown line.
   */
  function pondSpec() {
    return {
      ...fixedHoleSpec(),
      water: [
        {
          points: [
            { x: -20, z: 30 },
            { x: 20, z: 30 },
            { x: 20, z: 60 },
            { x: -20, z: 60 },
          ],
        },
      ],
    };
  }

  beforeEach(async () => {
    sim = await holeSim(pondSpec(), 0);
  });

  /** Find a water cell on this hole -- the pond is placed above but do not assume where. */
  function findWater(s: Sim): { x: number; z: number } {
    const half = s.bounds.maxX - 4;
    for (let x = -half; x <= half; x += 2) {
      for (let z = -half; z <= half; z += 2) {
        if (s.surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
      }
    }
    throw new Error(`no water cell found scanning [-${half}, ${half}] step 2 on both axes`);
  }

  it("costs exactly one point of health on the tick it enters", () => {
    const water = findWater(sim);

    // Settle first, so the cart has a last-safe position recorded on dry land.
    play(sim, [{ ticks: 30, intent: {} }]);
    const hpBefore = sim.cart.health.hp;

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.health.hp).toBe(hpBefore - 1);
  });

  it("does not drain health every tick while it sits there", () => {
    const water = findWater(sim);
    play(sim, [{ ticks: 30, intent: {} }]);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();
    const afterFirst = sim.cart.health.hp;

    // Put it straight back in; the edge only re-arms once the cart is out of the water.
    for (let i = 0; i < 10; i++) {
      sim.cart.position.x = water.x;
      sim.cart.position.z = water.z;
      sim.step();
    }
    expect(sim.cart.health.hp).toBe(afterFirst);
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

  it("charges nothing while the cart is dead and awaiting respawn", () => {
    const water = findWater(sim);
    play(sim, [{ ticks: 30, intent: {} }]);
    (sim as unknown as { killCart: (cart: Cart, victim: number, killer: number) => void }).killCart(sim.cart, 0, -1);
    const hpBefore = sim.cart.health.hp;

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.health.hp).toBe(hpBefore);
  });
});

describe("the match clock", () => {
  it("counts down from the default duration", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    expect(sim.matchTimeRemaining).toBe(MATCH_DURATION_S);
    expect(sim.matchOver).toBe(false);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.matchTimeRemaining).toBeCloseTo(MATCH_DURATION_S - 1, 5);
  });

  it("runs to the end in a handful of ticks when a test shortens it", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0, 5 / 60);
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchTimeRemaining).toBe(0);
    expect(sim.matchOver).toBe(true);
  });

  it("freezes the world once the match is over", async () => {
    const sim = await holeSim(fixedHoleSpec(), 1, 5 / 60);
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
    const sim = await holeSim(fixedHoleSpec(), 1, 5 / 60);
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOver).toBe(true);

    // The renderer never reads `sim.cart` -- it lerps `previousCart` -> `currentCart` by an alpha
    // that keeps sweeping 0..1 every tick period even though `step()` is now a no-op. If those
    // pairs are left one tick apart from whenever the buzzer happened to land, a moving cart
    // visibly oscillates forever after the match has "ended".
    expect(sim.previousCart.position.x).toBe(sim.currentCart.position.x);
    expect(sim.previousCart.position.z).toBe(sim.currentCart.position.z);
    expect(sim.previousCart.heading).toBe(sim.currentCart.heading);
    expect(sim.previousBotCarts[0]!.position.x).toBe(sim.currentBotCarts[0]!.position.x);
    expect(sim.previousBotCarts[0]!.position.z).toBe(sim.currentBotCarts[0]!.position.z);

    // And that equality must survive further ticks, not just hold by luck on the buzzer tick
    // itself -- step() is a no-op from here on, so the pairs must stay collapsed indefinitely.
    const intent = neutralIntent();
    intent.throttle = 1;
    for (let i = 0; i < 30; i++) sim.step(intent);
    expect(sim.previousCart.position.x).toBe(sim.currentCart.position.x);
  });

  it("keeps the score a cart died on: a death before the closing tick still counts", async () => {
    // matchDurationS is 5/60, so the buzzer fires on the 5th step() (the tick where
    // matchTimeRemaining first falls to <= half a tick). When this test was written that tick
    // returned early and never touched a cart, so killing the bot and then taking only the *last*
    // step ran no tick over the dead bot at all. The buzzer tick is simulated now ("simulates the
    // buzzer tick" below), but the test still kills after 3 steps, so the 4th -- a tick that is
    // plainly not the last -- is the one shown to process the death (stepRespawn counts the timer
    // down) before the 5th ends the match.
    const sim = await holeSim(fixedHoleSpec(), 1, 5 / 60);
    for (let i = 0; i < 3; i++) sim.step();
    (sim as unknown as { killCart: (cart: Cart, victim: number, killer: number) => void }).killCart(sim.bots[0]!, 1, 0);

    sim.step();
    expect(sim.matchOver).toBe(false); // the 4th tick is real, not the early return
    expect(sim.bots[0]!.dead).toBe(true); // and it did land on the dead cart

    sim.step();
    expect(sim.matchOver).toBe(true);
    expect(sim.match.strokesFor(1)).toBe(1);
    expect(sim.match.winningTeam()).toBe(0);
  });

  it("simulates the buzzer tick rather than discarding it", async () => {
    // A one-second match is 60 ticks, and the 60th is the one that ends it. The player drives the
    // whole way and puts a ball in the air early, so both the cart and the physics world have
    // something to move on the last tick. Each check is a different half of "the tick happened":
    // the cart moves in `stepCarts`, the ball only in `world.step`.
    const sim = await holeSim(fixedHoleSpec(), 0, 1);
    const drive = neutralIntent();
    drive.throttle = 1;
    const fire = { ...drive, fire: true };
    for (let i = 0; i < 59; i++) sim.step(i < 10 ? fire : drive);
    expect(sim.matchOver).toBe(false);
    const flying = (sim as unknown as { ballPool: BallPool }).ballPool.all.find((b) => b.state === "flying");
    expect(flying).toBeDefined();
    const cartBefore = { ...sim.cart.position };
    const ballBefore = flying!.body.translation();

    sim.step(drive);

    expect(sim.matchOver).toBe(true);
    expect(Math.hypot(sim.cart.position.x - cartBefore.x, sim.cart.position.z - cartBefore.z)).toBeGreaterThan(0.05);
    const ballAfter = flying!.body.translation();
    expect(Math.hypot(ballAfter.x - ballBefore.x, ballAfter.z - ballBefore.z)).toBeGreaterThan(0.05);
  });

  it("reset re-rolls the clock and clears the result", async () => {
    const sim = await holeSim(fixedHoleSpec(), 1, 5 / 60);
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOver).toBe(true);

    sim.reset();

    expect(sim.matchOver).toBe(false);
    expect(sim.matchTimeRemaining).toBeCloseTo(5 / 60, 9);
  });
});

/**
 * The causeway (spec D5), driven rather than described. **This is the test that proves the design**:
 * a crossing is only worth building if a cart can actually get over the water on it, and every
 * other assertion about the crossing is about geometry rather than about play.
 */
describe("driving a crossing", () => {
  /** The fixture with a pond straight across the corridor -- holes 2, 13 and 15's forced carry. */
  function carrySpec(): HoleSpec {
    return {
      ...fixedHoleSpec(),
      water: [
        {
          points: [
            { x: -20, z: -40 },
            { x: 4, z: -40 },
            { x: 4, z: 40 },
            { x: -20, z: 40 },
          ],
        },
      ],
    };
  }

  /**
   * Drives the cart from `fromT` to `toT` along the deck and reports what it cost.
   *
   * Position is written and the world stepped, the same way `driving into water`'s tests above
   * place a cart on a pond: what is under test is the surface classification and the height field,
   * not the throttle curve.
   */
  function driveAlong(sim: Sim, deck: Crossing, samples: number) {
    const hpBefore = sim.cart.health.hp;
    let lost = 0;
    let lowest = Infinity;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = deck.ax + (deck.bx - deck.ax) * t;
      const z = deck.az + (deck.bz - deck.az) * t;
      sim.cart.position.x = x;
      sim.cart.position.z = z;
      sim.cart.position.y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
      sim.step();
      lost = hpBefore - sim.cart.health.hp;
      lowest = Math.min(lowest, sim.heightAt(x, z));
    }
    return { lost, lowest };
  }

  it("carries a cart over the water without losing any health", async () => {
    const sim = await holeSim(carrySpec(), 0);
    play(sim, [{ ticks: 30, intent: {} }]);
    expect(sim.cart.health.hp).toBe(ARENA_MAX_HEALTH);

    const deck = deriveCrossings(carrySpec())[0]!;
    const run = driveAlong(sim, deck, 60);

    expect(run.lost).toBe(0);
    // And it really did go over the pond rather than round it: the deck is above the water line
    // the whole way, on ground the pond would otherwise have excavated 1.5 m below it.
    expect(run.lowest).toBeGreaterThan(carrySpec().waterLevel);
  });

  it("still charges the crossing's own pond a metre off the shoulder", async () => {
    // The other half, and what stops the first test passing because the pond stopped being water.
    const sim = await holeSim(carrySpec(), 0);
    play(sim, [{ ticks: 30, intent: {} }]);

    const deck = deriveCrossings(carrySpec())[0]!;
    const dx = deck.bx - deck.ax;
    const dz = deck.bz - deck.az;
    const length = Math.hypot(dx, dz);
    const offset = DECK_HALF_WIDTH + DECK_SHOULDER_RUN + 1;
    const x = (deck.ax + deck.bx) / 2 - (dz / length) * offset;
    const z = (deck.az + deck.bz) / 2 + (dx / length) * offset;

    expect(sim.surfaces.surfaceAt(x, z)).toBe(SurfaceId.Water);
    sim.cart.position.x = x;
    sim.cart.position.z = z;
    sim.step();
    expect(sim.cart.health.hp).toBe(ARENA_MAX_HEALTH - 1);
  });

  it("leaves a dry hole with no crossing to drive", async () => {
    expect(deriveCrossings(fixedHoleSpec())).toHaveLength(0);
  });
});

/**
 * Stage C's attribution, at the seam `Sim` actually owns. `combat.ts` no longer touches
 * `Sim.stats` at all -- it reports who fired and this class decides -- so this is the layer the
 * rule lives on and the layer worth asserting it at.
 */
describe("whose accuracy a hit belongs to", () => {
  function creditFrom(sim: Sim, shooter: number): void {
    const ctx = (sim as unknown as {
      combatContext: { onBallHit: (s: number, v: number, d: number, x: number, y: number, z: number) => void };
    }).combatContext;
    ctx.onBallHit(shooter, 1, 1, 0, 0, 0);
  }

  it("counts a hit from the player's own ball", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    creditFrom(sim, 0);
    expect(sim.stats.directHits).toBe(1);
  });

  it("does not count a bot's hit toward the player's accuracy", async () => {
    // The fix for `docs/TEST-AND-SPEC-PITFALLS.md` §4: `combat.ts` had no way to tell whose ball it
    // was, so every hit anywhere on the course inflated the number the results screen reports.
    const sim = await holeSim();
    creditFrom(sim, 1);
    expect(sim.stats.directHits).toBe(0);
  });
});

describe("spawn protection", () => {
  it("is granted by a respawn and by nothing else", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    // Alive and freshly created: no shield. The control that keeps the assertion below from
    // passing against protection being handed out at construction.
    expect(sim.cart.protectedFor).toBe(0);

    sim.cart.health.hp = 0;
    sim.cart.dead = true;
    sim.cart.respawnTimer = RESPAWN_DELAY_S;
    for (let i = 0; i < seconds(RESPAWN_DELAY_S) + 1; i++) sim.step();

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.protectedFor).toBeGreaterThan(0);
  });

  it("is not handed out again by a reset", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    sim.cart.protectedFor = 3;
    sim.reset();
    expect(sim.cart.protectedFor).toBe(0);
  });

  it("ends on the shot rather than on the timer", async () => {
    const sim = await holeSim(fixedHoleSpec(), 0);
    // Far longer than this test runs, so the timer cannot be what ends it.
    sim.cart.protectedFor = 999;
    expect(sim.cart.fire(1)).toBe(true);
    expect(sim.cart.protectedFor).toBe(0);
  });
});
