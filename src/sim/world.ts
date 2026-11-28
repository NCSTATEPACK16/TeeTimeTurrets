/**
 * The match simulation: the `Sim` class, its state, and the fixed step.
 *
 * Since Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md §4) the work lives in
 * modules beside this one, as functions over the `Sim`: `physicsWorld.ts` (the Rapier world and the
 * cart bodies), `rigs.ts`, `hazardRules.ts`, `respawn.ts`, `shots.ts`, `botDriver.ts`,
 * `simPickups.ts` and `snapshot.ts`. This file keeps the fields they read, `create`, `step` -- which
 * calls them in the order the tick has always run, so every RNG draw and every event keeps its
 * place -- `reset` and `dispose`. Members marked `@internal` are for those modules and tests, not
 * for anything outside `src/sim/**`.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { Cart, TireType, computeMuzzle } from "./entities/Cart";
import { BallPool, POOL_SIZE } from "./entities/BallPool";
import type { PooledBall } from "./entities/BallPool";
import { SHIELD_DECAY_S, createPickupStates, isCharged, resetPickups } from "./pickups";
import type { PickupState } from "./pickups";
import { clubhouseObstacles, clubhouseShapes } from "./clubhouse";
import type { StaticShape } from "./clubhouse";
import { navGraphFor } from "./navGraph";
import type { NavGraph } from "./navGraph";
import type { Obstacle } from "./lineOfSight";
import { CombatRegistry, processContacts } from "./combat";
import type { CombatContext } from "./combat";
import { createStats } from "./stats";
import { MatchTally } from "./scoring";
import { DEFAULT_KIT, applyLoadout } from "./upgrades";
import type { CartKit } from "./upgrades";
import { CaptureField } from "./flags";
import { Barrage, MAX_BARRAGES, MORTAR_CHANNEL, MORTAR_DROP_SPEED } from "./mortar";
import type { Vec3 } from "./course";
import type { SouthBoundary } from "./courseBarrier";
import { createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";
import type { Playfield, PlayfieldHeightfield } from "./playfield";
import type { Bounds } from "./courseLayout";
import type { ArenaGround } from "./arena";
import type { ArenaZone } from "./arenaZone";
import { Match } from "./match";
import type { MatchPhase } from "./match";
import { ARENA_MAX_HEALTH, MATCH_DURATION_S, SPAWN_CHANNEL } from "./matchConfig";
import { createSpawnSet, createTeamPads } from "./spawn";
import type { SpawnPoint } from "./spawn";
import { hashChannel, mulberry32 } from "./rng";
import { NO_RIG, SimEventLog } from "./events";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, PREVIEW_MAX_POINTS } from "./tickConstants";
import { buildPhysics, freePhysics, moveCartBody } from "./physicsWorld";
import type { CartTransform, CartRig } from "./rigs";
import { createCartTransform, placeRig, cartsOf, gradeAlong } from "./rigs";
import { killCart, stepRespawn, openingPoint } from "./respawn";
import { checkCartWater, checkCartZone } from "./hazardRules";
import {
  callMortar,
  stepBarrages,
  applySplash,
  creditHit,
  resolveShot,
  previewTrajectory,
} from "./shots";
import { IDLE_INTENT, intentFor } from "./botDriver";
import { collectPickups } from "./simPickups";
import { holdPrevious, syncCurrentCart, syncCurrentPool } from "./snapshot";

export type { Vec3 } from "./course";
export type { CartTransform } from "./rigs";
export {
  CART_AUTOSTEP_HEIGHT,
  CART_AUTOSTEP_MIN_WIDTH,
  CART_MAX_SLOPE_CLIMB_DEG,
  CART_MIN_SLOPE_SLIDE_DEG,
  CART_SNAP_TO_GROUND,
  CHARACTER_OFFSET,
  GRAVITY,
  addStaticColliders,
} from "./physicsWorld";

/**
 * The tick's constants, and the preview buffer, live in `tickConstants.ts`: the renderer needs
 * them, and importing them from here would pull Rapier into every chunk that draws a ball.
 */
export {
  FIXED_DT,
  POOL_TRANSFORM_STRIDE,
  PREVIEW_MAX_POINTS,
  PREVIEW_SAMPLE_STRIDE,
  TRANSFORM_STRIDE,
  createPreviewBuffer,
} from "./tickConstants";

/**
 * Re-exported from `matchConfig.ts`, which is where it lives along with every other arena tunable.
 * Kept exported here because the smoke driver imports it from this module.
 */
export { MATCH_DURATION_S };

export interface SimOptions {
  /**
   * AI carts to create. Tests that want the player's cart in isolation pass 0 -- a second cart
   * is a second source of contacts, ammo pickups and shunts. Defaults to 1.
   */
  readonly botCount?: number;
  /** Seconds on the match clock. Defaults to MATCH_DURATION_S. */
  readonly matchDurationS?: number;
  /**
   * Seconds of pre-match countdown, during which carts can aim and change club but not drive or
   * fire, and bots idle. Defaults to 0 (live from the first tick); the game passes
   * `MATCH_COUNTDOWN_S`.
   */
  readonly countdownS?: number;
  /**
   * The player cart's purchased stats: tyre, armour, ammo capacity, reload and the driver lock
   * (Stage 8, `sim/upgrades.ts`). Defaults to `DEFAULT_KIT`, today's cart. Bots always get that.
   */
  readonly kit?: CartKit;
}

/**
 * The match: carts on the arena ground, the balls they fire, and the clock and scoreboard that
 * decide it. There is one mode -- the arena -- and `create` is handed the ground to fight on.
 */
export class Sim {
  /** @internal */
  world!: RAPIER.World;
  /** @internal Rig 0 is the player's; rigs 1.. are `bots`, in the same order. */
  readonly rigs: CartRig[] = [];
  /** @internal */
  controller!: RAPIER.KinematicCharacterController;
  /** @internal Set by `dispose`. A disposed Sim has freed its Rapier world and must not be stepped. */
  disposed = false;
  /** @internal The ground under everything: heights, materials, bounds and the collider's heightfield. */
  readonly playfield: Playfield;
  /** @internal The playfield's collider heights, built by the first `buildGround` and reused after it. */
  heightfield: PlayfieldHeightfield | null = null;
  /**
   * Cart state from the previous fixed step, for render interpolation. Two buffers for the player
   * and two per bot, swapped every step and written in place: a render reads one pair while the
   * next tick fills the other, and the tick allocates neither.
   */
  previousCart: CartTransform;
  /** Cart state from the most recent fixed step. */
  currentCart: CartTransform;
  /** The player's cart state machine. Read for the HUD; drive it through `step`. */
  readonly cart: Cart;
  /** AI-controlled carts, in rig order after the player. */
  readonly bots: Cart[] = [];
  /** Bot cart transforms from the previous fixed step, for render interpolation. One per bot. */
  previousBotCarts: CartTransform[] = [];
  /** Bot cart transforms from the most recent fixed step. One per bot. */
  currentBotCarts: CartTransform[] = [];
  /** @internal */
  ballPool!: BallPool;
  /** @internal Every pickup site's live state, in `ArenaGround.pickupSites` order. */
  readonly pickupStates: PickupState[];
  /** @internal The clubhouse complex's colliders, rebuilt into every fresh Rapier world. */
  readonly staticShapes: readonly StaticShape[];
  /** The buildings as sight-line blockers, for bots here and for the nameplates. */
  readonly obstacles: readonly Obstacle[];
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  previousPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Pooled ball transforms from the most recent fixed step. */
  currentPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** The player's shot counters, for the results screen's accuracy. See sim/stats.ts. */
  readonly stats = createStats();
  /**
   * Every cart's kills, assists, damage and pickups this match, for the earnings (Stage 8,
   * `sim/scoring.ts`). Counted, never read back by the sim, and cleared by `reset`.
   */
  readonly tally = new MatchTally();

  /** @internal Collider handle -> entity, so a drained collision event can be dispatched. */
  readonly registry = new CombatRegistry();
  /** @internal */
  eventQueue!: RAPIER.EventQueue;
  /** @internal Built once: `processContacts` runs every tick and must not allocate its context. */
  combatContext!: CombatContext;
  /** @internal Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  simTime = 0;
  /** True when the player's last trigger pull put a ball in the air rather than firing a blank. */
  lastShotWasStrike = false;
  /** @internal Reused per-tick scratch, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  readonly moveScratch: Vec3 = { x: 0, y: 0, z: 0 };
  /** @internal Landed balls in pickup range of one cart, filled by `BallPool.ballsNear`. */
  readonly nearScratch: PooledBall[] = [];
  /** @internal */
  readonly launchScratch: Vec3 = { x: 0, y: 0, z: 0 };
  /** @internal Reused by `moveCartBody`'s barrier clamp: no per-tick allocation in the fixed loop. */
  readonly clampScratch = { x: 0, z: 0 };
  /** @internal */
  readonly muzzleScratch: Vec3 = { x: 0, y: 0, z: 0 };
  /** @internal */
  readonly previewScratch: Vec3 = { x: 0, y: 0, z: 0 };
  /** @internal */
  readonly botTarget = { x: 0, z: 0, dead: false, hidden: false, driveX: 0, driveZ: 0, holdAtDrive: false };
  /** @internal */
  readonly seekScratch = { x: 0, z: 0 };
  /**
   * Everything that happened, for whatever reacts to it: markers, the kill feed, effects, audio.
   * Every cart's events, not just the player's; a reader filters. See `events.ts`.
   */
  readonly events = new SimEventLog();
  /** @internal `holdIntent`'s output, reused every countdown tick. */
  readonly countdownIntent: PlayerIntent = { ...neutralIntent(), brake: true, cancelCharge: true };
  /** @internal Ticks stepped since the match started, stamped on each event. */
  tickCount = 0;
  /**
   * The bots' navigation graph over the zone (Stage 6, `navGraph.ts`), or null on a ground with no
   * zone, where bots drive straight as they always did. Shared by every `Sim` on the same ground.
   * @internal
   */
  readonly nav: NavGraph | null;
  /** @internal */
  readonly cartTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
  /** The clock and the scoreboard. Its roster is set in `create`, once every rig exists. */
  readonly match: Match;
  /**
   * Capture flags A, B and C (Stage 3.5c). Read-only outside the sim, like `match`: the HUD, the
   * map and the flags on the greens read it, and only `step` changes it. No flags on a ground
   * with no `captureSites`.
   */
  readonly captures: CaptureField;
  /** Seconds left on the match clock. Counts down every `step()` until it hits zero. */
  get matchTimeRemaining(): number {
    return this.match.remaining;
  }
  /** Set once, on the tick the clock reaches zero. Every later `step()` is a no-op. */
  get matchOver(): boolean {
    return this.match.over;
  }
  /** Countdown, live or over. The countdown holds every cart but lets the player aim. */
  get matchPhase(): MatchPhase {
    return this.match.phase;
  }
  /** @internal The road carts are held north of, or null where the ground has none. */
  readonly southBoundary: SouthBoundary | null;
  /** Where the match is fought, or null on a ground without one. See `ArenaGround.zone`. */
  readonly zone: ArenaZone | null;
  /** @internal */
  readonly zoneScratch = { x: 0, z: 0 };
  /** @internal One tee per spawn hole, in the course frame. */
  readonly spawnSet: SpawnPoint[];
  /** @internal The clubhouse team pads, `[team][slot]`, or null on a ground with no clubhouse. */
  readonly teamPads: SpawnPoint[][] | null;
  /** @internal Root of the match's seeded streams; see `ArenaGround.seed`. */
  readonly seed: number;
  /**
   * The stream respawn tees are drawn from. Seeded from the ground rather than the clock, per the
   * `AGENTS.md` no-`Math.random`-in-the-sim rule, and re-seeded by `reset()` so "play again" is a
   * genuine rerun.
   * @internal
   */
  spawnRandom: () => number;
  /**
   * The Mulligan Mortar's spread (Stage 3.5c): one stream for the match, seeded on its own channel
   * and rebuilt by `reset`, as `spawnRandom` is. A bot's own stream is never drawn on for a mortar,
   * so calling one shifts no bot's later decisions.
   * @internal
   */
  mortarRandom: () => number;
  /** @internal Mortars in the air, in fixed slots. See `mortar.ts`. */
  readonly barrages: Barrage[] = Array.from({ length: MAX_BARRAGES }, () => new Barrage());
  /** @internal The arc a mortar is aimed along, written by `previewTrajectory`. Made once. */
  readonly mortarArc: Vec3[] = Array.from({ length: PREVIEW_MAX_POINTS }, () => ({ x: 0, y: 0, z: 0 }));
  /** @internal */
  readonly mortarVelocity: Vec3 = { x: 0, y: -MORTAR_DROP_SPEED, z: 0 };
  /** @internal `flagToDefend`'s per-flag enemy counts, reused. Three flags at most. */
  readonly flagCounts = new Int32Array(3);
  /** @internal See `Sim.carts`. Grown once and reused, per the no-allocation-in-the-tick rule. */
  readonly cartsScratch: Cart[] = [];

  private constructor(ground: ArenaGround, matchDurationS: number, countdownS: number, tire: TireType) {
    this.playfield = ground.playfield;
    this.southBoundary = ground.southBoundary;
    this.zone = ground.zone;
    this.seed = ground.seed;
    this.spawnSet = createSpawnSet(ground.holes, (x, z) => ground.playfield.heightAt(x, z));
    const heightAt = (x: number, z: number): number => ground.playfield.heightAt(x, z);
    this.teamPads = ground.clubhouse === null ? null : createTeamPads(ground.clubhouse, heightAt);
    this.staticShapes = ground.clubhouse === null ? [] : clubhouseShapes(ground.clubhouse, heightAt);
    this.obstacles = ground.clubhouse === null ? [] : clubhouseObstacles(ground.clubhouse, heightAt);
    this.nav =
      ground.zone === null
        ? null
        : navGraphFor({ heightAt, surfaces: ground.playfield.surfaces, zone: ground.zone, obstacles: this.obstacles });
    this.pickupStates = createPickupStates(ground.pickupSites);
    this.spawnRandom = mulberry32(hashChannel(this.seed, SPAWN_CHANNEL));
    this.mortarRandom = mulberry32(hashChannel(this.seed, MORTAR_CHANNEL));
    this.match = new Match({ playerCount: 1, durationS: matchDurationS, countdownS });
    this.captures = new CaptureField(
      ground.captureSites.map((p) => ({ x: p.x, y: heightAt(p.x, p.z), z: p.z })),
    );
    this.cart = new Cart({ maxHealth: ARENA_MAX_HEALTH, tire });
    this.currentCart = createCartTransform();
    this.previousCart = createCartTransform();
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
    const sim = new Sim(
      ground,
      options.matchDurationS ?? MATCH_DURATION_S,
      options.countdownS ?? 0,
      (options.kit ?? DEFAULT_KIT).tire,
    );
    // The one place the player's purchases become stats (Stage 8).
    applyLoadout(sim.cart, options.kit ?? DEFAULT_KIT);

    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      sim.currentBotCarts.push(createCartTransform());
      sim.previousBotCarts.push(createCartTransform());
      // Bots fire the putter, not the default driver. A fired ball launches at its club's loft
      // from a ~2.4 m muzzle, so a lofted club sails clean over a cart at any range a bot would
      // stand off at. The putter is flat, so its shot lands on the target at `BOT_STANDOFF`.
      sim.bots.push(new Cart({ maxHealth: ARENA_MAX_HEALTH, club: ClubType.Putter }));
    }
    buildPhysics(sim);

    sim.combatContext = {
      registry: sim.registry,
      onBallHit: (shooter, victim, damage, x, y, z) => creditHit(sim, shooter, victim, damage, x, y, z),
      onRamDamage: (rammer, victim, damage, x, y, z) => {
        sim.tally.damaged(rammer, victim, damage, sim.tickCount);
        sim.events.push("ram", sim.tickCount, rammer, victim, damage, x, y, z);
      },
      onCartKilled: (cart, victim, killer) => killCart(sim, cart, victim, killer),
      onShieldHit: (attacker, victim, byBall, x, y, z) => {
        if (byBall && attacker === 0) sim.stats.directHits += 1;
        sim.events.push("plateBroken", sim.tickCount, attacker, victim, sim.rigs[victim]!.cart.shield, x, y, z);
      },
    };
    // Now that every rig exists. The scoreboard is indexed by rig index.
    sim.match.setRoster(sim.rigs.length);
    for (const rig of sim.rigs) placeRig(rig, openingPoint(sim, rig.index));

    syncCurrentCart(sim);
    holdPrevious(sim);
    sim.ballPool.sync();
    syncCurrentPool(sim);
    sim.previousPoolTransforms.set(sim.currentPoolTransforms);
    return sim;
  }

  /**
   * Every pickup site and when it recharges, in `ArenaGround.pickupSites` order, for the map and
   * the pillars. The live array rather than a copy: UI is a pure consumer of sim state.
   */
  get pickups(): readonly PickupState[] {
    return this.pickupStates;
  }

  /** Whether pickup site `i` is charged right now. */
  pickupCharged(i: number): boolean {
    return isCharged(this.pickupStates[i]!, this.simTime);
  }

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
    // Read before the tick: the tick that spends the last of the countdown is still a held one.
    const counting = this.match.countdownRemaining > 0;
    this.match.tick(FIXED_DT);
    this.tickCount++;
    const swapPool = this.previousPoolTransforms;
    this.previousPoolTransforms = this.currentPoolTransforms;
    this.currentPoolTransforms = swapPool;

    const swapCart = this.previousCart;
    this.previousCart = this.currentCart;
    this.currentCart = swapCart;
    const swapBots = this.previousBotCarts;
    this.previousBotCarts = this.currentBotCarts;
    this.currentBotCarts = swapBots;
    this.stepCarts(counting ? this.holdIntent(intent) : intent, counting);
    syncCurrentCart(this);

    // Stepping with the queue is what fills it; combat.ts drains it immediately afterwards, so
    // no contact is ever carried into the following tick.
    this.world.step(this.eventQueue);
    processContacts(this.eventQueue, this.combatContext);
    this.ballPool.sync();
    syncCurrentPool(this);

    // Flags after contacts, so a cart killed this tick holds nothing. Live ticks only: the
    // countdown takes no flag, and the tick that ends the match bleeds nothing.
    if (!counting && !this.match.over) this.captures.tick(cartsOf(this), this.match, this.events, this.tickCount);

    // The tick that ends the match is still a whole tick -- carts move, balls fly, a hit lands and
    // a kill scores -- and only then does the world freeze. Every previous/current pair collapses
    // onto its current value, so a renderer lerping between them holds still rather than hanging
    // one tick apart forever.
    if (this.match.over) {
      holdPrevious(this);
      this.previousPoolTransforms.set(this.currentPoolTransforms);
    }
  }

  /**
   * Per-tick world bookkeeping that belongs to no single cart, then one `stepRig` call per cart.
   * Split that way so the pool and the buckets tick exactly once however many carts are in play.
   */
  private stepCarts(intent: PlayerIntent, counting: boolean): void {
    // The world keeps running while a cart is out of it: balls already in flight land, and
    // pickups keep recharging (against `simTime`). Only the cart is frozen.
    this.simTime += FIXED_DT;
    this.ballPool.step(FIXED_DT, this.simTime);
    applySplash(this);
    stepBarrages(this);

    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i]!;
      // During the countdown a bot idles without drawing on its RNG stream, so its first live
      // tick is the same whatever the countdown's length.
      const rigIntent = counting && rig.random !== null ? IDLE_INTENT : intentFor(this, rig, intent);
      this.stepRig(rig, rigIntent);
    }
  }

  /**
   * The player's intent with only the aim and the club kept: the countdown lets a player line up
   * a shot but not drive, and a charge started before FORE! is cancelled rather than banked.
   */
  private holdIntent(intent: PlayerIntent): PlayerIntent {
    const held = this.countdownIntent;
    held.aimDelta = intent.aimDelta;
    held.selectClub = intent.selectClub;
    return held;
  }

  /** Intent -> cart state -> body movement -> shot resolution, for exactly one cart. */
  private stepRig(rig: CartRig, intent: PlayerIntent): void {
    const cart = rig.cart;
    if (cart.dead) {
      stepRespawn(this, rig);
      return;
    }

    if (intent.selectClub !== null) cart.selectClub(intent.selectClub);

    const c = cart.position;
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    cart.step(intent, FIXED_DT, this.cartTuningScratch, gradeAlong(this, c.x, c.z, cart.heading));
    if (cart.stepShield(FIXED_DT, SHIELD_DECAY_S)) {
      this.events.push("plateBroken", this.tickCount, NO_RIG, rig.index, cart.shield, c.x, c.y, c.z);
    }
    moveCartBody(this, rig);
    checkCartWater(this, rig);
    // Water can kill: a dead cart is out of the world, and the zone has nothing more to say to it.
    if (!cart.dead) checkCartZone(this, rig);

    collectPickups(this, rig);

    if (cart.shot.fired) {
      cart.shot.fired = false;
      resolveShot(this, rig);
    }
    if (intent.callMortar && cart.mortars > 0) callMortar(this, rig);
  }

  /** Where a shot from the player's turret would leave from. */
  muzzle(out: Vec3): void {
    computeMuzzle(this.cart, out);
  }

  /**
   * The aim-preview arc of the shot that firing *now* would make (UI-SPEC H10): `shots.ts`'s
   * `previewTrajectory`, which touches no Rapier state. `out` is a caller-held buffer of at least
   * `PREVIEW_MAX_POINTS` reused `Vec3`s; returns how many points it wrote.
   */
  previewTrajectory(charge01: number, yaw: number, out: Vec3[]): number {
    return previewTrajectory(this, charge01, yaw, out);
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
   * - Every pickup is charged, and the pool's despawn clock (`simTime`) starts from zero.
   * - Every cart is rearmed as well as revived: starting club and ammo, no reload, no charge.
   */
  reset(): void {
    this.lastShotWasStrike = false;
    this.match.reset();
    this.tally.reset();
    this.captures.reset();
    this.spawnRandom = mulberry32(hashChannel(this.seed, SPAWN_CHANNEL));
    this.mortarRandom = mulberry32(hashChannel(this.seed, MORTAR_CHANNEL));
    for (const barrage of this.barrages) barrage.clear();
    freePhysics(this);
    buildPhysics(this);
    resetPickups(this.pickupStates);
    this.simTime = 0;
    this.tickCount = 0;

    for (const rig of this.rigs) {
      placeRig(rig, openingPoint(this, rig.index));
      rig.cart.revive();
      rig.cart.rearm();
    }

    syncCurrentCart(this);
    holdPrevious(this);
    this.ballPool.sync();
    syncCurrentPool(this);
    this.previousPoolTransforms.set(this.currentPoolTransforms);
  }

  /**
   * Frees the Rapier world and everything in it. Rapier's WASM heap is not garbage-collected, so a
   * Sim dropped without this leaks its whole world -- one per match played. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    freePhysics(this);
  }
}

