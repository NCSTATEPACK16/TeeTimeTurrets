import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType } from "../physics/Ballistics";
import type { PlayerIntent } from "./intent";
import { Cart, TireType, computeMuzzle } from "./entities/Cart";
import { BallPool } from "./entities/BallPool";
import type { Bucket } from "./entities/Pickup";
import { CombatRegistry, processContacts } from "./combat";
import type { CombatContext } from "./combat";
import { createStats } from "./stats";
import { createTally } from "./scoring";
import { applyLoadout } from "./upgrades";
import type { UpgradeLevels } from "./upgrades";
import type { Loadout } from "./loadout";
import type { Vec3 } from "./course";
import { maxClimbRad } from "./mobility";
import { applyPathBonus, pathWeightAt } from "./cartPaths";
import { buildNavGraph, navGraphFor } from "./navGraph";
import type { NavGraph } from "./navGraph";
import type { CartPath } from "./cartPaths";
import type { ArenaZone } from "./arenaZone";
import { createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";
import type { Playfield, PlayfieldHeightfield } from "./playfield";
import type { Bounds } from "./courseLayout";
import type { ArenaGround } from "./arena";
import { Match } from "./match";
import { ARENA_MAX_HEALTH, MATCH_DURATION_S, NO_KILLER } from "./matchConfig";
import { addCartRig, placeRig } from "./rigs";
import { createMoveScratch, createPhysicsWorld, freePhysicsWorld, gradeAlong, moveCartBody } from "./physicsWorld";
import type { CartLimits, PhysicsWorld } from "./physicsWorld";
import { checkCartWater, checkZone } from "./hazardRules";
import type { HazardDeath } from "./hazardRules";
import { SpawnPlan, stepRespawn } from "./respawn";
import { previewTrajectory, resolveShot } from "./shots";
import { BotDriver, IDLE_INTENT } from "./botDriver";
import { RenderSnapshot } from "./snapshot";
import { MatchCredit } from "./credit";
import { collectPickups, placeBuckets, resetBuckets, stepBuckets } from "./pickups";
import type { CartRig } from "./rigs";
import { SimEventLog } from "./events";
import { FIXED_DT } from "./frame";
import type { CartTransform } from "./frame";



export interface SimOptions {
  /**
   * AI carts to create. Tests that want the player's cart in isolation pass 0 -- a second cart
   * is a second source of contacts, ammo pickups and shunts. Defaults to 1.
   */
  readonly botCount?: number;
  /** Seconds on the match clock. Defaults to MATCH_DURATION_S. */
  readonly matchDurationS?: number;
  /**
   * The player cart's tire. Defaults to `TireType.Street`. The one clubhouse purchase that is a
   * stat rather than a skin: `TIRE_TUNING` scales top speed, grip and surface penalties.
   */
  readonly tire?: TireType;
  /**
   * What the player bought and has earned: tyre, upgrades and level, applied to the player's cart
   * by `applyLoadout`. Overrides `tire`.
   */
  readonly player?: { readonly loadout: Loadout; readonly upgrades: UpgradeLevels; readonly level: number };
}

/**
 * The match: carts on the arena ground, the balls they fire, and the clock and scoreboard that
 * decide it. There is one mode -- the arena -- and `create` is handed the ground to fight on.
 */
export class Sim {
  private physics!: PhysicsWorld;
  /** Rig 0 is the player's; rigs 1.. are `bots`, in the same order. */
  private readonly rigs: CartRig[] = [];
  /** Set by `dispose`. A disposed Sim has freed its Rapier world and must not be stepped. */
  private disposed = false;
  /** The ground under everything: heights, materials, bounds and the collider's heightfield. */
  private readonly playfield: Playfield;
  /** The playfield's collider heights, built by the first `buildGround` and reused after it. */
  private heightfield: PlayfieldHeightfield | null = null;
  /** The render transforms: every cart's and every pooled ball's, previous and current. */
  private readonly snapshot: RenderSnapshot;
  /** Cart state from the previous fixed step, for render interpolation. */
  get previousCart(): CartTransform {
    return this.snapshot.previousCart;
  }
  /** Cart state from the most recent fixed step. */
  get currentCart(): CartTransform {
    return this.snapshot.currentCart;
  }
  /** The player's cart state machine. Read for the HUD; drive it through `step`. */
  readonly cart: Cart;
  /** AI-controlled carts, in rig order after the player. */
  readonly bots: Cart[] = [];
  /** Bot cart transforms from the previous fixed step, for render interpolation. One per bot. */
  get previousBotCarts(): readonly CartTransform[] {
    return this.snapshot.previousBotCarts;
  }
  /** Bot cart transforms from the most recent fixed step. One per bot. */
  get currentBotCarts(): readonly CartTransform[] {
    return this.snapshot.currentBotCarts;
  }
  private ballPool!: BallPool;
  /** Ammo buckets. One for now; course-scale supply placement is Stage D's. */
  private readonly buckets: Bucket[] = [];
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  get previousPoolTransforms(): Float32Array {
    return this.snapshot.previousPoolTransforms;
  }
  /** Pooled ball transforms from the most recent fixed step. */
  get currentPoolTransforms(): Float32Array {
    return this.snapshot.currentPoolTransforms;
  }
  /** The player's shot counters, for the results screen's accuracy. See sim/stats.ts. */
  readonly stats = createStats();
  /**
   * What the player did this match -- kills, assists, damage, pickups -- for the results screen's
   * score, coins and XP (sim/scoring.ts). Unlike `stats`, a rematch starts it again: it is what one
   * match earned.
   */
  readonly tally = createTally();
  /** What happened, for hit markers, the kill feed, effects and audio. See `sim/events.ts`. */
  readonly events = new SimEventLog();
  /** Scores kills and hits into the match, the events, `stats` and `tally`. See credit.ts. */
  private readonly credit: MatchCredit;

  /** Collider handle -> entity, so a drained collision event can be dispatched. */
  private readonly registry = new CombatRegistry();
  private eventQueue!: RAPIER.EventQueue;
  /** Built once: `processContacts` runs every tick and must not allocate its context. */
  private combatContext!: CombatContext;
  /** Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  private simTime = 0;
  /** True when the player's last trigger pull put a ball in the air rather than firing a blank. */
  lastShotWasStrike = false;
  /** Reused by `moveCartBody`, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  private readonly moveScratch = createMoveScratch();
  private readonly muzzleScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly previewScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly cartTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
  /** The clock and the scoreboard. Its roster is set in `create`, once every rig exists. */
  readonly match: Match;
  /** Seconds left on the match clock. Counts down every `step()` until it hits zero. */
  get matchTimeRemaining(): number {
    return this.match.remaining;
  }
  /** Set once, on the tick the clock reaches zero. Every later `step()` is a no-op. */
  get matchOver(): boolean {
    return this.match.over;
  }
  /** Where a cart may be moved to: the ground's box, the road north of it and the zone's reach. */
  private readonly limits: CartLimits;
  /** Where the match is played, or null on a ground that is all playable. */
  readonly zone: ArenaZone | null;
  /** Cart paths, where a cart runs faster. Empty on a test ground. */
  private readonly paths: readonly CartPath[];
  /** Where bots can drive, on a ground with a zone; built once per course. See navGraph.ts. */
  private readonly nav: NavGraph | null;
  /** Targets, ammo runs and routes for every bot. See botDriver.ts. */
  private readonly driver: BotDriver;
  /** Where carts start and come back. See respawn.ts. */
  private readonly spawns: SpawnPlan;
  /** Root of the match's seeded streams; see `ArenaGround.seed`. */
  private readonly seed: number;
  /** See `Sim.carts`. Grown once and reused, per the no-allocation-in-the-tick rule. */
  private readonly cartsScratch: Cart[] = [];

  private constructor(ground: ArenaGround, matchDurationS: number, tire: TireType) {
    this.playfield = ground.playfield;
    this.zone = ground.zone ?? null;
    this.limits = { playfield: ground.playfield, southBoundary: ground.southBoundary, zone: this.zone };
    this.paths = ground.paths ?? [];
    const zone = this.zone;
    this.nav =
      zone === null
        ? null
        : navGraphFor(ground.playfield, () =>
            buildNavGraph(zone, (x, z) => ground.playfield.heightAt(x, z), ground.playfield.surfaces, this.paths),
          );
    this.driver = new BotDriver(this.nav, this.zone, this.buckets);
    this.seed = ground.seed;
    this.spawns = new SpawnPlan(ground, this.seed);
    this.match = new Match({ playerCount: 1, durationS: matchDurationS });
    this.cart = new Cart({ maxHealth: ARENA_MAX_HEALTH, tire });
    this.snapshot = new RenderSnapshot(this.cart);
    this.credit = new MatchCredit(this.match, this.events, this.stats, this.tally);
  }

  /** The materials under everything. */
  get surfaces(): Surfaces {
    return this.playfield.surfaces;
  }

  /** The box the ground covers. Past it there is nothing to stand on. */
  get bounds(): Bounds {
    return this.playfield.bounds;
  }

  /** Ground height at a world point -- the render layer's line-of-sight test reads this. */
  heightAt(x: number, z: number): number {
    return this.playfield.heightAt(x, z);
  }

  static async create(ground: ArenaGround, options: SimOptions = {}): Promise<Sim> {
    await RAPIER.init();
    const sim = new Sim(ground, options.matchDurationS ?? MATCH_DURATION_S, options.tire ?? TireType.Street);
    if (options.player) applyLoadout(sim.cart, options.player.loadout, options.player.upgrades, options.player.level);

    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      // Bots fire the putter, not the default driver. A fired ball launches at its club's loft
      // from a ~2.4 m muzzle, so a lofted club sails clean over a cart at any range a bot would
      // stand off at. The putter is flat, so its shot lands on the target at `BOT_STANDOFF`.
      sim.bots.push(new Cart({ maxHealth: ARENA_MAX_HEALTH, club: ClubType.Putter }));
    }
    sim.buildPhysics();

    placeBuckets(ground, sim.buckets);

    sim.combatContext = {
      registry: sim.registry,
      onBallHit: (shooter, victim, damage, x, y, z) => sim.credit.hit(shooter, victim, damage, x, y, z, sim.simTime),
      onCartKilled: (cart, victim, killer) => sim.killCart(cart, victim, killer),
    };
    // Now that every rig exists. The scoreboard is indexed by rig index.
    sim.match.setRoster(sim.rigs.length);
    for (const rig of sim.rigs) placeRig(rig, sim.spawns.openingPoint(rig.index));

    sim.snapshot.syncCarts(sim.cart, sim.bots);
    sim.snapshot.syncPool(sim.ballPool);
    sim.snapshot.hold();
    return sim;
  }

  /**
   * The Rapier world and everything in it: the ground, the character controller, a body per cart
   * and the ball pool, each registered for contact dispatch, and a rig per cart with a fresh bot
   * stream and mind. Every cart must already exist; `placeRig` puts them down afterwards.
   *
   * `create` and `reset` both build through here, in this order, so a rematch runs in a world
   * with the same handles and no history -- exactly the world the first match had. Teleporting
   * carts around the old world instead leaves its broadphase and contact state behind, and a
   * rematch then drifts from the first match from its very first tick.
   */
  private buildPhysics(): void {
    this.heightfield ??= this.playfield.buildHeightfield();
    const physics = createPhysicsWorld(this.heightfield);
    this.physics = physics;

    this.rigs.length = 0;
    this.registry.clear();
    addCartRig(this.physics.world, this.registry, this.rigs, this.cart, null, false);

    this.ballPool = new BallPool(this.physics.world, {
      heightAt: (x, z) => this.playfield.heightAt(x, z),
      tuningAt: (x, z, out) => this.playfield.surfaces.tuningAt(x, z, out),
    });
    this.eventQueue = new RAPIER.EventQueue(true);
    for (const pooled of this.ballPool.all) {
      this.registry.registerBall(pooled.body.collider(0).handle, pooled);
    }
    for (let i = 0; i < this.bots.length; i++) {
      addCartRig(this.physics.world, this.registry, this.rigs, this.bots[i]!, { seed: this.seed, index: i }, this.nav !== null);
    }
  }

  /** Frees what `buildPhysics` made. Rapier's WASM heap is not garbage-collected. */
  private freePhysics(): void {
    this.eventQueue.free();
    freePhysicsWorld(this.physics);
  }

  /**
   * The buckets on the ground, for the map to mark. Readonly, and the array is the live one rather
   * than a copy: UI is a pure consumer of sim state, so handing it the array grants nothing.
   */
  get pickups(): readonly Bucket[] {
    return this.buckets;
  }

  /** See `MatchCredit.kill`. A method so tests can kill a cart directly. */
  private killCart(cart: Cart, victim: number, killer: number): void {
    this.credit.kill(cart, victim, killer, this.simTime);
  }

  /** A drowning or a drained bar: a death nobody caused. Built once, so a tick allocates none. */
  private readonly hazardDeath: HazardDeath = (cart, victim) => this.killCart(cart, victim, NO_KILLER);

  /**
   * Advance exactly one fixed tick. Call in a while-loop from an accumulator, never per render
   * frame.
   *
   * The carts are stepped before `world.step()` on purpose: `computeColliderMovement` is a query
   * against the current world, and `setNextKinematicTranslation` is consumed by the step that
   * follows it.
   */
  step(intent: PlayerIntent = IDLE_INTENT): void {
    if (this.disposed) throw new Error("Sim.step called after dispose()");
    // A finished match freezes exactly where it stood.
    if (this.match.over) return;
    this.match.tick(FIXED_DT);
    this.snapshot.beginTick();
    this.stepCarts(intent);
    this.snapshot.syncCarts(this.cart, this.bots);

    // Stepping with the queue is what fills it; combat.ts drains it immediately afterwards, so
    // no contact is ever carried into the following tick.
    this.physics.world.step(this.eventQueue);
    processContacts(this.eventQueue, this.combatContext);
    this.snapshot.syncPool(this.ballPool);

    // The tick that ends the match is still a whole tick -- carts move, balls fly, a hit lands and
    // a kill scores -- and only then does the world freeze. Every previous/current pair collapses
    // onto its current value, so a renderer lerping between them holds still rather than hanging
    // one tick apart forever.
    if (this.match.over) {
      this.snapshot.hold();
    }
  }

  /**
   * Per-tick world bookkeeping that belongs to no single cart, then one `stepRig` call per cart.
   * Split that way so the pool and the buckets tick exactly once however many carts are in play.
   */
  private stepCarts(intent: PlayerIntent): void {
    // The world keeps running while a cart is out of it: balls already in flight land, and
    // bucket cooldowns keep ticking. Only the cart is frozen.
    this.simTime += FIXED_DT;
    this.ballPool.step(FIXED_DT, this.simTime);
    stepBuckets(this.buckets);

    for (const rig of this.rigs) {
      this.stepRig(rig, this.driver.intentFor(rig, intent, this.rigs, this.carts, this.ballPool));
    }
  }

  /** Intent -> cart state -> body movement -> shot resolution, for exactly one cart. */
  private stepRig(rig: CartRig, intent: PlayerIntent): void {
    const cart = rig.cart;
    if (cart.dead) {
      stepRespawn(rig, this.spawns, this.carts, this.events);
      return;
    }

    if (intent.selectClub !== null) cart.selectClub(intent.selectClub);

    const c = cart.position;
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    if (this.paths.length > 0) applyPathBonus(this.cartTuningScratch, pathWeightAt(this.paths, c.x, c.z));
    cart.step(intent, FIXED_DT, this.cartTuningScratch, gradeAlong(this.playfield, c.x, c.z, cart.heading));
    // The controller is shared, so each cart sets its own climb limit before it moves: the ground
    // under it and its tyres decide how steep a face it can drive up (see mobility.ts).
    this.physics.controller.setMaxSlopeClimbAngle(maxClimbRad(this.cartTuningScratch, cart.tire));
    moveCartBody(this.physics.controller, rig, this.limits, this.moveScratch);
    checkCartWater(rig, this.surfaces, this.events, this.hazardDeath);
    checkZone(rig, this.zone, this.hazardDeath);
    if (cart.dead) return;

    collectPickups(rig, this.buckets, this.ballPool, this.events, this.tally);

    if (cart.shot.fired) {
      cart.shot.fired = false;
      this.resolveShot(rig);
    }
  }

  /**
   * Every cart in rig order, for the spawn module's clearance check. Rebuilt lazily and cached:
   * `respawnPoint` wants an indexable list, but a `map` per respawn would allocate inside a tick.
   */
  private get carts(): readonly Cart[] {
    if (this.cartsScratch.length !== this.rigs.length) {
      this.cartsScratch.length = 0;
      for (const rig of this.rigs) this.cartsScratch.push(rig.cart);
    }
    return this.cartsScratch;
  }

  /** See `resolveShot` in shots.ts. A method, not an inline call, so tests can fire a rig directly. */
  private resolveShot(rig: CartRig): void {
    const struck = resolveShot(rig, this.ballPool, this.events, this.stats, this.muzzleScratch);
    if (rig.index === 0) this.lastShotWasStrike = struck;
  }

  /** Where a shot from the player's turret would leave from. */
  muzzle(out: Vec3): void {
    computeMuzzle(this.cart, out);
  }

  /**
   * The arc a shot fired *now* would fly, for the aim preview (UI-SPEC H10): points from the muzzle
   * to first ground contact, written into `out`. Reads no Rapier state. See `previewTrajectory` in
   * shots.ts.
   */
  previewTrajectory(charge01: number, yaw: number, out: Vec3[]): number {
    return previewTrajectory(this.playfield, this.cart, charge01, yaw, out, this.previewScratch);
  }

  /**
   * "Play again": the same match from the top. Every cart back on its opening tee at full health,
   * the clock and scoreboard cleared, every seeded stream back at its start -- a rerun, not a
   * continuation. `stats` survives, being the session's accuracy.
   *
   * The test of it is that the same inputs replay the first match exactly
   * (`arenaGolden.test.ts`), so nothing the last match left behind may survive:
   * - The physics world is rebuilt (`buildPhysics`), which also empties the ball pool and gives
   *   each bot a fresh stream and mind with the same skill.
   * - Every bucket is off cooldown, and the pool's despawn clock (`simTime`) starts from zero.
   * - Every cart is rearmed as well as revived: starting club and ammo, no reload, no charge.
   */
  reset(): void {
    this.lastShotWasStrike = false;
    this.match.reset();
    this.credit.reset();
    this.spawns.reset();
    this.freePhysics();
    this.buildPhysics();
    resetBuckets(this.buckets);
    this.simTime = 0;

    for (const rig of this.rigs) {
      placeRig(rig, this.spawns.openingPoint(rig.index));
      rig.cart.revive();
      rig.cart.rearm();
    }

    this.snapshot.syncCarts(this.cart, this.bots);
    this.snapshot.syncPool(this.ballPool);
    this.snapshot.hold();
  }

  /**
   * Frees the Rapier world and everything in it. Rapier's WASM heap is not garbage-collected, so a
   * Sim dropped without this leaks its whole world -- one per match played. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.freePhysics();
  }
}
