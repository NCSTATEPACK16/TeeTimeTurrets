import RAPIER from "@dimforge/rapier3d-compat";
import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../physics/Ballistics";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { BUCKET_REFILL_AMMO, CART_COLLIDER, CART_HULL, Cart, RESPAWN_DELAY_S, TireType, computeMuzzle } from "./entities/Cart";
import { BallPool, POOL_SIZE } from "./entities/BallPool";
import { BALL_RADIUS } from "./entities/ballShape";
import { createBucket, stepBucket, tryTakeBucket } from "./entities/Pickup";
import type { Bucket } from "./entities/Pickup";
import { CombatRegistry, STROKE_DAMAGE, processContacts } from "./combat";
import { CART_GROUPS, HULL_GROUPS } from "./collisionGroups";
import type { CombatContext } from "./combat";
import { applyDamage } from "./health";
import { createStats } from "./stats";
import type { Vec3 } from "./course";
import { clampToPlayable } from "./courseBarrier";
import { maxClimbRad } from "./mobility";
import { ZONE_CLAMP_REACH_M, clampToZone, outOfBoundsDrain, zoneSignedDistance } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import type { SouthBoundary } from "./courseBarrier";
import { SurfaceId, createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";
import type { Playfield, PlayfieldHeightfield } from "./playfield";
import type { Bounds } from "./courseLayout";
import type { ArenaGround } from "./arena";
import { BOT_CHANNEL, BOT_SKILL_CHANNEL, NO_TARGET, computeBotIntent, createBotMind, pickTarget } from "./bot";
import type { BotMind, BotTarget } from "./bot";
import { Match } from "./match";
import {
  ARENA_MAX_HEALTH,
  MATCH_DURATION_S,
  NO_KILLER,
  SPAWN_CHANNEL,
  SPAWN_PROTECTION_S,
  teamOf,
} from "./matchConfig";
import { createSpawnSet, createTeamPads, openingSpawn, padSpawn, respawnPoint } from "./spawn";
import type { SpawnPoint } from "./spawn";
import { hashChannel, mulberry32 } from "./rng";
import { NO_TARGET_RIG, SimEventLog } from "./events";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, PREVIEW_MAX_POINTS, PREVIEW_MAX_TICKS, PREVIEW_SAMPLE_STRIDE } from "./frame";
import type { CartTransform } from "./frame";

export type { Vec3 } from "./course";

/**
 * Re-exported from `matchConfig.ts`, which is where it lives along with every other arena tunable.
 * Kept exported here because the smoke driver imports it from this module.
 */
export { MATCH_DURATION_S };

// The clock and the render-facing shapes live in `frame.ts`, which does not import Rapier, so the
// renderer and the page's entry can use them without loading the physics engine.
export {
  FIXED_DT,
  POOL_TRANSFORM_STRIDE,
  PREVIEW_MAX_POINTS,
  PREVIEW_SAMPLE_STRIDE,
  TRANSFORM_STRIDE,
  createPreviewBuffer,
} from "./frame";
export type { CartTransform } from "./frame";

function writePreviewPoint(out: Vec3[], i: number, x: number, y: number, z: number): void {
  const p = out[i]!;
  p.x = x;
  p.y = y;
  p.z = z;
}

/**
 * Air drag on a fired ball, mirrored by `previewTrajectory` so the aim arc matches the flight.
 * Must equal `BallPool`'s own linear damping; `previewTrajectory.test.ts` holds the two together
 * by landing a real shot where the preview said it would.
 */
const LINEAR_DAMPING = 0.05;

export const GRAVITY = 9.81;

/**
 * How close a cart has to be to a landed ball or a bucket to collect it. Ammo is the only thing a
 * landed ball is for, so driving over your own spent rounds is how a cart reloads between buckets.
 */
const PICKUP_RANGE = 3.0;

/**
 * KCC tuning. Slope limits are what stop the cart driving up a wall or sticking to one.
 *
 * The two slope angles are exported because the causeway is designed against them: at a 1.0 m
 * heightfield cell there is no deck width that behaves like a bridge, only shoulders the cart drives
 * up (under the climb limit) or cannot leave (over it). A second copy of 32 in a terrain test would
 * let the crossing and the controller drift apart.
 *
 * The rest are exported for `tools/terrainProbe.ts`, for the same reason: a probe that times
 * `computeColliderMovement` against its own controller settings is timing a different vehicle.
 */
export const CHARACTER_OFFSET = 0.02;
/** The controller's climb limit before any cart has moved; each cart then sets its own (mobility.ts). */
export const CART_MAX_SLOPE_CLIMB_DEG = 45;
export const CART_MIN_SLOPE_SLIDE_DEG = 32;
export const CART_AUTOSTEP_HEIGHT = 0.45;
export const CART_AUTOSTEP_MIN_WIDTH = 0.25;
export const CART_SNAP_TO_GROUND = 0.6;

/** Half the span the cart's grade is measured over: about half a wheelbase. */
const GRADE_HALF_BASE_M = 1.2;

/**
 * Everything the world owns for one cart: the state machine, the kinematic body it drives, the
 * collider that generates its contacts, and the fall speed the KCC does not integrate for us.
 *
 * Bundled rather than kept as parallel arrays because every one of these is looked up together,
 * every time. Rig 0 is always the player's; the rest are bots, in `bots` order.
 */
interface CartRig {
  /**
   * Its own position in `Sim.rigs`. 0 is always the player's. It is the identity of a player
   * everywhere in the project -- `bots[i - 1]`, the nameplates and the scoreboard all index by it.
   */
  readonly index: number;
  readonly cart: Cart;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  fallSpeed: number;
  /**
   * The bot's own seeded stream. `null` for the player's rig, which is not AI-driven.
   * Deliberately not `readonly`: `reset()` re-seeds it so "play again" is a genuine rerun.
   */
  random: (() => number) | null;
  /** Reused per tick so the bot's intent costs no allocation. `null` for the player's rig. */
  readonly intentScratch: PlayerIntent | null;
  /** The rig this bot is fighting, per `pickTarget`, or `NO_TARGET`. Unused by the player's rig. */
  targetIndex: number;
  /**
   * What the bot remembers between ticks (`sim/bot.ts`): its skill, its progress tracking and the
   * ammo it is heading for. `null` for the player's rig. Written in place every tick.
   */
  readonly mind: BotMind | null;
}

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
}

/**
 * The match: carts on the arena ground, the balls they fire, and the clock and scoreboard that
 * decide it. There is one mode -- the arena -- and `create` is handed the ground to fight on.
 */
export class Sim {
  private world!: RAPIER.World;
  /** Rig 0 is the player's; rigs 1.. are `bots`, in the same order. */
  private readonly rigs: CartRig[] = [];
  private controller!: RAPIER.KinematicCharacterController;
  /** Set by `dispose`. A disposed Sim has freed its Rapier world and must not be stepped. */
  private disposed = false;
  /** The ground under everything: heights, materials, bounds and the collider's heightfield. */
  private readonly playfield: Playfield;
  /** The playfield's collider heights, built by the first `buildGround` and reused after it. */
  private heightfield: PlayfieldHeightfield | null = null;
  /** Cart state from the previous fixed step, for render interpolation. */
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
  /**
   * The two transforms each cart's `previous`/`current` pair is drawn from, swapped every tick:
   * the new `current` is written into whichever one `previous` is not holding. A renderer
   * interpolating between the pair never sees either overwritten under it, and a tick allocates no
   * transform at all.
   */
  private readonly cartBuffers: [CartTransform, CartTransform] = [blankTransform(), blankTransform()];
  private readonly botBuffers: [CartTransform, CartTransform][] = [];
  private ballPool!: BallPool;
  /** Ammo buckets. One for now; course-scale supply placement is Stage D's. */
  private readonly buckets: Bucket[] = [];
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  previousPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Pooled ball transforms from the most recent fixed step. */
  currentPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** The player's shot counters, for the results screen's accuracy. See sim/stats.ts. */
  readonly stats = createStats();
  /** What happened, for hit markers, the kill feed, effects and audio. See `sim/events.ts`. */
  readonly events = new SimEventLog();

  /** Collider handle -> entity, so a drained collision event can be dispatched. */
  private readonly registry = new CombatRegistry();
  private eventQueue!: RAPIER.EventQueue;
  /** Built once: `processContacts` runs every tick and must not allocate its context. */
  private combatContext!: CombatContext;
  /** Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  private simTime = 0;
  /** True when the player's last trigger pull put a ball in the air rather than firing a blank. */
  lastShotWasStrike = false;
  /** Reused per-tick scratch, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  private readonly moveScratch: Vec3 = { x: 0, y: 0, z: 0 };
  /** Reused by `moveCartBody`'s barrier clamp: no per-tick allocation in the fixed loop. */
  private readonly clampScratch = { x: 0, z: 0 };
  private readonly muzzleScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly previewScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly botTarget = { x: 0, z: 0, dead: false };
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
  /** The road carts are held north of, or null where the ground has none. */
  private readonly southBoundary: SouthBoundary | null;
  /** Where the match is played, or null on a ground that is all playable. */
  readonly zone: ArenaZone | null;
  /** One tee per spawn hole, in the course frame. */
  private readonly spawnSet: SpawnPoint[];
  /** The clubhouse team pads, `[team][slot]`, or null on a ground with no clubhouse. */
  private readonly teamPads: SpawnPoint[][] | null;
  /** Root of the match's seeded streams; see `ArenaGround.seed`. */
  private readonly seed: number;
  /**
   * The stream respawn tees are drawn from. Seeded from the ground rather than the clock, per the
   * `AGENTS.md` no-`Math.random`-in-the-sim rule, and re-seeded by `reset()` so "play again" is a
   * genuine rerun.
   */
  private spawnRandom: () => number;
  /** See `Sim.carts`. Grown once and reused, per the no-allocation-in-the-tick rule. */
  private readonly cartsScratch: Cart[] = [];

  private constructor(ground: ArenaGround, matchDurationS: number, tire: TireType) {
    this.playfield = ground.playfield;
    this.southBoundary = ground.southBoundary;
    this.zone = ground.zone ?? null;
    this.seed = ground.seed;
    this.spawnSet = createSpawnSet(ground.holes, (x, z) => ground.playfield.heightAt(x, z));
    this.teamPads =
      ground.clubhouse === null ? null : createTeamPads(ground.clubhouse, (x, z) => ground.playfield.heightAt(x, z));
    this.spawnRandom = mulberry32(hashChannel(this.seed, SPAWN_CHANNEL));
    this.match = new Match({ playerCount: 1, durationS: matchDurationS });
    this.cart = new Cart({ maxHealth: ARENA_MAX_HEALTH, tire });
    this.currentCart = writeTransform(this.cart, this.cartBuffers[0]);
    this.previousCart = this.currentCart;
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

    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      // Bots fire the putter, not the default driver. A fired ball launches at its club's loft
      // from a ~2.4 m muzzle, so a lofted club sails clean over a cart at any range a bot would
      // stand off at. The putter is flat, so its shot lands on the target at `BOT_STANDOFF`.
      sim.bots.push(new Cart({ maxHealth: ARENA_MAX_HEALTH, club: ClubType.Putter }));
    }
    sim.buildPhysics();

    // KNOWN MISPLACEMENT, kept for one commit so the refactor around it can be shown to change
    // nothing: this is hole 1's *local* tee plus 10 m, read as a course coordinate, which is where
    // the arena has always put its bucket. The next change moves it and says so.
    const firstHole = ground.holes.find((h) => h.spec.index === 0) ?? ground.holes[0]!;
    sim.buckets.push(createBucket(firstHole.spec.tee.x + 10, firstHole.spec.tee.z));

    sim.combatContext = {
      registry: sim.registry,
      onBallHit: (shooter, victim, damage, x, y, z) => sim.creditHit(shooter, victim, damage, x, y, z),
      onCartKilled: (cart, victim, killer) => sim.killCart(cart, victim, killer),
    };
    // Now that every rig exists. The scoreboard is indexed by rig index.
    sim.match.setRoster(sim.rigs.length);
    for (const rig of sim.rigs) sim.placeRig(rig, sim.openingPoint(rig.index));

    sim.syncCurrentCart();
    sim.collapseRenderPairs();
    sim.syncCurrentPool();
    sim.previousPoolTransforms.set(sim.currentPoolTransforms);
    return sim;
  }

  /**
   * Bot `i`'s seeded stream. The `0` is the slot a hole index occupied when arena was built on top
   * of a hole-1 `Sim`; it stays so a recorded match replays unchanged.
   */
  private botStreamSeed(botIndex: number): number {
    return hashChannel(this.seed, 0, BOT_CHANNEL, botIndex);
  }

  /**
   * Bot `i`'s skill, 0..1: the first draw of its own `BOT_SKILL_CHANNEL` stream, so it is fixed
   * per seed and giving bots a skill moves none of their `BOT_CHANNEL` draws.
   */
  private botSkill(botIndex: number): number {
    return mulberry32(hashChannel(this.seed, 0, BOT_SKILL_CHANNEL, botIndex))();
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
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.buildGround();

    this.controller = this.world.createCharacterController(CHARACTER_OFFSET);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((CART_MIN_SLOPE_SLIDE_DEG * Math.PI) / 180);
    this.controller.enableAutostep(CART_AUTOSTEP_HEIGHT, CART_AUTOSTEP_MIN_WIDTH, true);
    this.controller.enableSnapToGround(CART_SNAP_TO_GROUND);
    // A future flag-ball has to be shovable by the cart, and a KCC ignores dynamic bodies unless
    // told otherwise. Nudging a landed ball by driving into it is correct behaviour anyway.
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.rigs.length = 0;
    this.registry.clear();
    this.addCartRig(this.cart, null);

    this.ballPool = new BallPool(this.world, {
      heightAt: (x, z) => this.playfield.heightAt(x, z),
      tuningAt: (x, z, out) => this.playfield.surfaces.tuningAt(x, z, out),
    });
    this.eventQueue = new RAPIER.EventQueue(true);
    for (const pooled of this.ballPool.all) {
      this.registry.registerBall(pooled.body.collider(0).handle, pooled);
    }
    for (let i = 0; i < this.bots.length; i++) this.addCartRig(this.bots[i]!, i);
  }

  /** Frees what `buildPhysics` made. Rapier's WASM heap is not garbage-collected. */
  private freePhysics(): void {
    this.world.removeCharacterController(this.controller);
    this.eventQueue.free();
    this.world.free();
  }

  /**
   * Builds the heightfield collider for the ground. The heights are computed once per `Sim` and
   * kept, so a rematch does not rebuild them.
   */
  private buildGround(): void {
    this.heightfield ??= this.playfield.buildHeightfield();
    const field = this.heightfield;
    const groundDesc = RAPIER.ColliderDesc.heightfield(field.rows, field.cols, field.heights, {
      x: field.extentX,
      y: 1,
      z: field.extentZ,
    })
      // The course is a box that is not centred on anything, so the collider goes where its middle is.
      .setTranslation(field.centreX, 0, field.centreZ)
      .setFriction(0.8)
      .setRestitution(0.15);
    this.world.createCollider(groundDesc);
  }

  /**
   * The buckets on the ground, for the map to mark. Readonly, and the array is the live one rather
   * than a copy: UI is a pure consumer of sim state, so handing it the array grants nothing.
   */
  get pickups(): readonly Bucket[] {
    return this.buckets;
  }

  /**
   * Creates one cart's body and collider, registers it for contact dispatch, and files the rig.
   * Every cart -- the player's and every bot's -- goes through here, so a bot is physically
   * identical to the player rather than a cheaper approximation of one. `placeRig` puts it down.
   *
   * `botIndex` is the cart's place in `bots`, or `null` for the player. It is passed in rather than
   * read off `rigs.length`, which only equals it while the player's rig is the one already filed.
   */
  private addCartRig(cart: Cart, botIndex: number | null): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
        .setCollisionGroups(CART_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        // Rapier computes no contacts between two kinematic bodies by default, and every cart
        // here is kinematic -- without this, cart-vs-cart shunting generates no events at all.
        .setActiveCollisionTypes(
          RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
        ),
      body,
    );
    // Before the push, so it is the index this rig is about to occupy.
    const index = this.rigs.length;
    this.registry.registerCart(collider.handle, cart, index);
    // What a shot hits. Same body, so it moves with the cart for free; ball-only, so the cart
    // drives exactly as it did without it.
    const hull = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(CART_HULL.height / 2, CART_HULL.radius)
        .setTranslation(0, CART_HULL.centreOffset, 0)
        .setCollisionGroups(HULL_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.registry.registerCart(hull.handle, cart, index);
    this.rigs.push({
      index,
      cart,
      body,
      collider,
      fallSpeed: 0,
      random: botIndex === null ? null : mulberry32(this.botStreamSeed(botIndex)),
      intentScratch: botIndex === null ? null : neutralIntent(),
      targetIndex: NO_TARGET,
      mind: botIndex === null ? null : createBotMind(this.botSkill(botIndex)),
    });
  }

  /**
   * Death: the cart is out of the world for `RESPAWN_DELAY_S` and comes back at a spawn point.
   * Guarded on `dead` so two lethal contacts in one tick do not restart the timer. The death is
   * the stroke: `Match.scoreKill` charges it to the victim's team.
   */
  private killCart(cart: Cart, victim: number, killer: number): void {
    if (cart.dead) return;
    cart.dead = true;
    cart.respawnTimer = RESPAWN_DELAY_S;
    this.match.scoreKill(killer, victim);
    const p = cart.position;
    this.events.push("kill", killer, victim, p.x, p.y, p.z, 0, null);
    this.events.push("stroke", NO_TARGET_RIG, victim, p.x, p.y, p.z, this.match.teamStrokes(teamOf(victim)), null);
  }

  /**
   * A fired ball connected: `shooter` fired it, it hit `victim` and took `damage` off it. Every hit
   * is an event; only rig 0's may write `Sim.stats`, which is the **player's** -- the accuracy the
   * results screen reports.
   */
  private creditHit(shooter: number, victim: number, damage: number, x: number, y: number, z: number): void {
    this.events.push("hit", shooter, victim, x, y, z, damage, null);
    if (shooter === 0) this.stats.directHits += 1;
  }

  /** One cart onto one spawn point: position, facing, momentum and the body, in that order. */
  private placeRig(rig: CartRig, spawn: SpawnPoint): void {
    const cart = rig.cart;
    cart.position.x = spawn.x;
    cart.position.y = spawn.y + CART_COLLIDER.groundOffset;
    cart.position.z = spawn.z;
    cart.heading = spawn.heading;
    cart.turretOffset = 0;
    // The drop point after a hazard is where it now stands, not wherever it drowned.
    cart.lastSafePosition.x = cart.position.x;
    cart.lastSafePosition.y = cart.position.y;
    cart.lastSafePosition.z = cart.position.z;
    cart.wasInWater = false;
    rig.fallSpeed = 0;
    rig.body.setTranslation(cart.position, true);
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
    this.match.tick(FIXED_DT);
    const swapPool = this.previousPoolTransforms;
    this.previousPoolTransforms = this.currentPoolTransforms;
    this.currentPoolTransforms = swapPool;

    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) {
      this.previousBotCarts[i] = this.currentBotCarts[i]!;
    }
    this.stepCarts(intent);
    this.syncCurrentCart();

    // Stepping with the queue is what fills it; combat.ts drains it immediately afterwards, so
    // no contact is ever carried into the following tick.
    this.world.step(this.eventQueue);
    processContacts(this.eventQueue, this.combatContext);
    this.syncCurrentPool();

    // The tick that ends the match is still a whole tick -- carts move, balls fly, a hit lands and
    // a kill scores -- and only then does the world freeze. Every previous/current pair collapses
    // onto its current value, so a renderer lerping between them holds still rather than hanging
    // one tick apart forever.
    if (this.match.over) {
      this.collapseRenderPairs();
      this.previousPoolTransforms.set(this.currentPoolTransforms);
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
    for (const bucket of this.buckets) stepBucket(bucket, FIXED_DT);

    for (const rig of this.rigs) {
      this.stepRig(rig, this.intentFor(rig, intent));
    }
  }

  /** The player's rig gets the player's intent; a bot's gets whatever `sim/bot.ts` decides. */
  private intentFor(rig: CartRig, playerIntent: PlayerIntent): PlayerIntent {
    if (rig.random === null) return playerIntent;
    // Unreachable by construction (addCartRig always pairs a non-null random with a non-null
    // intentScratch) -- but a bot with no scratch must idle, not mirror the player's controls.
    if (rig.intentScratch === null) return IDLE_INTENT;
    // A dead cart's intent is never read by stepRig, so computing one here would only spend the
    // bot's RNG stream on a throwaway draw and make the draw count depend on death timing.
    if (rig.cart.dead) return IDLE_INTENT;
    rig.targetIndex = pickTarget(rig.index, rig.targetIndex, this.carts);
    if (rig.mind !== null) this.findAmmoFor(rig.cart, rig.mind);
    computeBotIntent(
      rig.cart,
      this.botTargetScratch(rig.targetIndex),
      FIXED_DT,
      rig.random,
      rig.intentScratch,
      rig.mind,
    );
    return rig.intentScratch;
  }

  /**
   * Writes the nearest ammo a cart could collect right now into `mind`: a bucket off cooldown or a
   * landed ball, whoever fired it -- the same two things `stepRig` refills from. Only while the
   * magazine is empty, since that is the only time the bot reads it. Loops the pool directly rather
   * than through `ballsNear`, which builds an array per call. Rapier's `translation()` still hands
   * back a fresh vector per landed ball; that is the pool's own per-tick cost too, and Stage 3's.
   */
  private findAmmoFor(cart: Cart, mind: BotMind): void {
    mind.hasAmmoTarget = false;
    if (cart.ammo > 0) return;
    const px = cart.position.x;
    const pz = cart.position.z;
    let best = Infinity;
    for (const bucket of this.buckets) {
      if (bucket.cooldownRemaining > 0) continue;
      if (this.zone !== null && zoneSignedDistance(this.zone, bucket.position.x, bucket.position.z) > 0) continue;
      const d = Math.hypot(bucket.position.x - px, bucket.position.z - pz);
      if (d < best) {
        best = d;
        mind.ammoX = bucket.position.x;
        mind.ammoZ = bucket.position.z;
      }
    }
    for (const ball of this.ballPool.all) {
      if (ball.state !== "landed") continue;
      const t = ball.body.translation();
      if (this.zone !== null && zoneSignedDistance(this.zone, t.x, t.z) > 0) continue;
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < best) {
        best = d;
        mind.ammoX = t.x;
        mind.ammoZ = t.z;
      }
    }
    mind.hasAmmoTarget = best < Infinity;
  }

  /**
   * The enemy a bot is fighting, written into one reused object per the no-allocation rule; a bot
   * never sees its target's `Cart` itself. With no living enemy it reads as a dead target, which
   * the bot idles against.
   */
  private botTargetScratch(targetIndex: number): BotTarget {
    const target = targetIndex === NO_TARGET ? null : this.rigs[targetIndex]!.cart;
    this.botTarget.x = target?.position.x ?? 0;
    this.botTarget.z = target?.position.z ?? 0;
    this.botTarget.dead = target === null || target.dead;
    // A bot never chases out of the zone: an enemy past the stakes is hunted from the edge.
    if (this.zone !== null) clampToZone(this.zone, this.botTarget.x, this.botTarget.z, 0, this.botTarget);
    return this.botTarget;
  }

  /** Intent -> cart state -> body movement -> shot resolution, for exactly one cart. */
  private stepRig(rig: CartRig, intent: PlayerIntent): void {
    const cart = rig.cart;
    if (cart.dead) {
      this.stepRespawn(rig);
      return;
    }

    if (intent.selectClub !== null) cart.selectClub(intent.selectClub);

    const c = cart.position;
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    cart.step(intent, FIXED_DT, this.cartTuningScratch, this.gradeAlong(c.x, c.z, cart.heading));
    // The controller is shared, so each cart sets its own climb limit before it moves: the ground
    // under it and its tyres decide how steep a face it can drive up (see mobility.ts).
    this.controller.setMaxSlopeClimbAngle(maxClimbRad(this.cartTuningScratch, cart.tire));
    this.moveCartBody(rig);
    this.checkCartWater(rig);
    this.checkZone(rig);
    if (cart.dead) return;

    const ammoBefore = cart.ammo;
    let collected = false;
    for (const bucket of this.buckets) {
      if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) {
        cart.addAmmo(BUCKET_REFILL_AMMO);
        collected = true;
      }
    }
    for (const landed of this.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
      cart.addAmmo(1);
      this.ballPool.release(landed);
      collected = true;
    }
    // One event for whatever this tick collected, with the rounds it actually gave: a full magazine
    // still takes the bucket, and says so with a zero.
    if (collected) this.events.push("pickup", rig.index, NO_TARGET_RIG, c.x, c.y, c.z, cart.ammo - ammoBefore, null);

    if (cart.shot.fired) {
      cart.shot.fired = false;
      this.resolveShot(rig);
    }
  }

  /**
   * Outside the zone a cart is warned at once and drains a point every two seconds; a drain that
   * empties the bar is a death nobody caused, like a drowning.
   */
  private checkZone(rig: CartRig): void {
    const cart = rig.cart;
    if (this.zone === null || cart.dead) return;
    const p = cart.position;
    if (zoneSignedDistance(this.zone, p.x, p.z) <= 0) {
      cart.outOfBoundsFor = 0;
      return;
    }
    const before = cart.outOfBoundsFor;
    cart.outOfBoundsFor += FIXED_DT;
    const drain = outOfBoundsDrain(before, cart.outOfBoundsFor);
    if (drain > 0 && applyDamage(cart.health, drain)) this.killCart(cart, rig.index, NO_KILLER);
  }

  /** The ground's rise over run along `heading` at (x, z), from two samples a wheelbase apart. */
  private gradeAlong(x: number, z: number, heading: number): number {
    const dx = Math.cos(heading) * GRADE_HALF_BASE_M;
    const dz = Math.sin(heading) * GRADE_HALF_BASE_M;
    return (this.playfield.heightAt(x + dx, z + dz) - this.playfield.heightAt(x - dx, z - dz)) / (2 * GRADE_HALF_BASE_M);
  }

  /**
   * Counts one cart's respawn delay down and puts it back on a tee when it expires. Intent is not
   * read at all while dead, so ammo, reload and position are frozen for the duration.
   */
  private stepRespawn(rig: CartRig): void {
    rig.cart.respawnTimer -= FIXED_DT;
    if (rig.cart.respawnTimer > 0) return;
    this.placeRig(rig, this.respawnPointFor(rig.index));
    rig.cart.revive();
    const p = rig.cart.position;
    this.events.push("respawn", NO_TARGET_RIG, rig.index, p.x, p.y, p.z, 0, null);
    // After `revive`, which clears it: protection is a property of respawning, granted here and
    // nowhere else, so `reset` starting a fresh match does not start it behind a shield.
    rig.cart.protectedFor = SPAWN_PROTECTION_S;
  }

  /** Where rig `index` starts a match: its team's pad by the clubhouse, or its dealt tee. */
  private openingPoint(index: number): SpawnPoint {
    return this.teamPads === null ? openingSpawn(this.spawnSet, index) : padSpawn(this.teamPads, index);
  }

  /**
   * Where rig `index` comes back: its own slot on its team's pad. With no clubhouse, a random tee
   * avoiding whoever is alive and standing on one -- `index` is passed because the cart's own body
   * is still lying where it died, and counting it would make its nearest tee unavailable to it.
   */
  private respawnPointFor(index: number): SpawnPoint {
    if (this.teamPads !== null) return padSpawn(this.teamPads, index);
    return respawnPoint(this.spawnSet, this.spawnRandom, this.carts, index);
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

  /**
   * A KCC has no gravity and receives no impulses, so both are this class's problem: fall speed
   * is integrated here, and the recoil that shoves the cart arrives already baked into
   * `cart.desiredTranslation` as a velocity term the cart decays itself.
   *
   * `computedMovement()` allocates inside the binding. That is the one unavoidable per-tick
   * allocation in this loop; everything on our side of the call reuses `moveScratch`.
   */
  private moveCartBody(rig: CartRig): void {
    rig.fallSpeed -= GRAVITY * FIXED_DT;
    this.moveScratch.x = rig.cart.desiredTranslation.x;
    this.moveScratch.y = rig.fallSpeed * FIXED_DT;
    this.moveScratch.z = rig.cart.desiredTranslation.z;

    // Filtered by the capsule's own groups, so the controller does not collide with hulls.
    this.controller.computeColliderMovement(rig.collider, this.moveScratch, undefined, CART_GROUPS);
    const corrected = this.controller.computedMovement();

    const p = rig.cart.position;
    // Held inside the ground's own box -- past it there are no heights, so nothing to stand on --
    // and, where there is one, north of the road: the box is axis-aligned and County Home Road is
    // not, so the box alone leaves a wedge of playable ground on the road side. See courseBarrier.ts.
    clampToPlayable(
      this.playfield.bounds,
      this.southBoundary,
      CART_COLLIDER.radius,
      p.x + corrected.x,
      p.z + corrected.z,
      this.clampScratch,
    );
    // And no further than the reach past the zone's stakes.
    if (this.zone !== null) {
      clampToZone(this.zone, this.clampScratch.x, this.clampScratch.z, ZONE_CLAMP_REACH_M, this.clampScratch);
    }
    p.x = this.clampScratch.x;
    p.y += corrected.y;
    p.z = this.clampScratch.z;

    if (this.controller.computedGrounded()) rig.fallSpeed = 0;
    rig.body.setNextKinematicTranslation(p);
  }

  /**
   * A cart in the water loses a point of health and is dropped back where it was last on dry land.
   * Edge-triggered on `wasInWater`, so a cart nosing into a pond pays once rather than once per tick.
   * A drowning that empties the bar is a death nobody caused: a stroke, and a point for nobody.
   */
  private checkCartWater(rig: CartRig): void {
    const cart = rig.cart;
    const p = cart.position;
    const inWater = this.surfaces.surfaceAt(p.x, p.z) === SurfaceId.Water;

    if (!inWater) {
      cart.wasInWater = false;
      // Recorded every dry tick: wherever the cart is now is somewhere it can be put back down.
      cart.lastSafePosition.x = p.x;
      cart.lastSafePosition.y = p.y;
      cart.lastSafePosition.z = p.z;
      return;
    }

    if (cart.wasInWater) return;
    cart.wasInWater = true;
    this.events.push("splash", NO_TARGET_RIG, rig.index, p.x, p.y, p.z, 0, null);

    if (applyDamage(cart.health, STROKE_DAMAGE)) this.killCart(cart, rig.index, NO_KILLER);

    const safe = cart.lastSafePosition;
    p.x = safe.x;
    p.y = safe.y;
    p.z = safe.z;
    cart.speed = 0;
    rig.fallSpeed = 0;
    rig.body.setTranslation(p, true);
  }

  /**
   * A trigger pull. With ammo it spawns a pooled ball at the muzzle; at zero ammo it was a blank,
   * whose recoil `Cart` has already applied. Only the player's shots count toward `Sim.stats`.
   */
  private resolveShot(rig: CartRig): void {
    const cart = rig.cart;
    const isPlayer = rig.index === 0;
    const muzzle = this.muzzleScratch;
    computeMuzzle(cart, muzzle);
    if (!cart.shot.hasBall) {
      if (isPlayer) this.lastShotWasStrike = false;
      this.events.push("dryfire", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, 0, cart.shot.club);
      return;
    }

    const pooled = this.ballPool.acquire(rig.index);
    if (!pooled) {
      // Every pooled body is up in the air at once. `Cart.fire()` already spent the round on the
      // assumption a ball would spawn; refund it so this degrades to a true no-op -- one that
      // sounds like an empty trigger rather than like nothing.
      cart.addAmmo(1);
      if (isPlayer) this.lastShotWasStrike = false;
      this.events.push("dryfire", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, 0, cart.shot.club);
      return;
    }

    if (isPlayer) {
      this.lastShotWasStrike = true;
      // "A shot fired" for accuracy purposes is a ball actually leaving the muzzle -- distinct
      // from ammo's own decrement, which a 0-ammo blank also triggers.
      this.stats.shotsFired += 1;
    }
    this.events.push("shot", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, cart.shot.charge01, cart.shot.club);
    pooled.body.setTranslation(muzzle, true);
    pooled.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    pooled.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    pooled.body.setLinvel(computeLaunchVelocity(cart.shot.club, cart.shot.charge01, cart.shot.yaw), true);
    // Set on every shot: the pool recycles bodies, so a putter ball may last have been a driver's.
    const stats = CLUB_STATS[cart.shot.club];
    pooled.body.setGravityScale(stats.gravityScale, true);
    pooled.damage = stats.damage;
  }

  /** Where a shot from the player's turret would leave from. */
  muzzle(out: Vec3): void {
    computeMuzzle(this.cart, out);
  }

  /**
   * A read-only forward integration of the shot that firing *now* would make, for the aim-preview
   * arc (UI-SPEC H10). Fills `out` with points from the muzzle to the ball's first ground contact
   * and returns how many it wrote.
   *
   * **It touches no Rapier state and advances nothing** -- `Sim` is byte-identical before and after.
   * It mirrors the ball's own flight integration (the club's scaled gravity plus `LINEAR_DAMPING` at `FIXED_DT`)
   * rather than reading the live world, so it is a pure function of its inputs. It predicts the
   * carry, not the roll: the arc ends where the ball lands, because that is what a player aims with.
   *
   * The equipped club is read from the cart, not passed: its loft sets both the muzzle and the
   * launch elevation. `out` is a caller-held buffer of at least `PREVIEW_MAX_POINTS` reused `Vec3`s.
   */
  previewTrajectory(charge01: number, yaw: number, out: Vec3[]): number {
    computeMuzzle(this.cart, this.previewScratch);
    let px = this.previewScratch.x;
    let py = this.previewScratch.y;
    let pz = this.previewScratch.z;

    const v = computeLaunchVelocity(this.cart.equippedClub, charge01, yaw);
    let vx = v.x;
    let vy = v.y;
    let vz = v.z;

    const gravity = GRAVITY * CLUB_STATS[this.cart.equippedClub].gravityScale;
    const damp = 1 / (1 + LINEAR_DAMPING * FIXED_DT);
    const bounds = this.playfield.bounds;
    const capacity = Math.min(out.length, PREVIEW_MAX_POINTS);

    let n = 0;
    writePreviewPoint(out, n++, px, py, pz); // the muzzle itself

    for (let tick = 1; tick <= PREVIEW_MAX_TICKS && n < capacity; tick++) {
      // Gravity then damping then integrate, the order Rapier applies to the real ball.
      vy -= gravity * FIXED_DT;
      vx *= damp;
      vy *= damp;
      vz *= damp;
      px += vx * FIXED_DT;
      py += vy * FIXED_DT;
      pz += vz * FIXED_DT;

      const ground = this.playfield.heightAt(px, pz) + BALL_RADIUS;
      const landed = py <= ground;
      const outside = px < bounds.minX || px > bounds.maxX || pz < bounds.minZ || pz > bounds.maxZ;

      if (landed || outside || tick % PREVIEW_SAMPLE_STRIDE === 0) {
        if (landed) py = ground; // the last point rests on the surface, not just under it
        writePreviewPoint(out, n++, px, py, pz);
      }
      if (landed || outside) break;
    }
    return n;
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
    this.spawnRandom = mulberry32(hashChannel(this.seed, SPAWN_CHANNEL));
    this.freePhysics();
    this.buildPhysics();
    for (const bucket of this.buckets) bucket.cooldownRemaining = 0;
    this.simTime = 0;

    for (const rig of this.rigs) {
      this.placeRig(rig, this.openingPoint(rig.index));
      rig.cart.revive();
      rig.cart.rearm();
    }

    this.syncCurrentCart();
    this.collapseRenderPairs();
    this.syncCurrentPool();
    this.previousPoolTransforms.set(this.currentPoolTransforms);
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

  /**
   * Snapshots each cart's own position rather than its rigid body's: a kinematic body only moves
   * when `world.step()` consumes the queued translation, so reading the body here would render
   * every cart one tick behind everything else.
   */
  private syncCurrentCart(): void {
    this.currentCart = writeTransform(this.cart, otherOf(this.cartBuffers, this.previousCart));
    for (let i = 0; i < this.bots.length; i++) {
      const pair = (this.botBuffers[i] ??= [blankTransform(), blankTransform()]);
      this.currentBotCarts[i] = writeTransform(this.bots[i]!, otherOf(pair, this.previousBotCarts[i]));
    }
  }

  /** Every previous/current pair onto its current value, so an interpolating renderer holds still. */
  private collapseRenderPairs(): void {
    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) this.previousBotCarts[i] = this.currentBotCarts[i]!;
  }

  /**
   * Flattens the pool into the current buffer. An idle ball is parked far below the world, so the
   * active flag is what stops the renderer drawing thirty-two spheres at y = -1000.
   *
   * A slot transitioning idle -> active this tick also gets `previousPoolTransforms` seeded with
   * the same transform, or the renderer would lerp the ball in from wherever its slot last was.
   */
  private syncCurrentPool(): void {
    const buffer = this.currentPoolTransforms;
    const previous = this.previousPoolTransforms;
    const balls = this.ballPool.all;
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const ball = balls[i];
      if (!ball || ball.state === "idle") {
        buffer[flat + 7] = 0;
        continue;
      }
      const wasActive = previous[flat + 7] === 1;
      const t = ball.body.translation();
      const r = ball.body.rotation();
      buffer[flat] = t.x;
      buffer[flat + 1] = t.y;
      buffer[flat + 2] = t.z;
      buffer[flat + 3] = r.x;
      buffer[flat + 4] = r.y;
      buffer[flat + 5] = r.z;
      buffer[flat + 6] = r.w;
      buffer[flat + 7] = 1;
      if (!wasActive) {
        for (let k = 0; k < POOL_TRANSFORM_STRIDE; k++) previous[flat + k] = buffer[flat + k]!;
      }
    }
  }
}

/** Neutral intent for callers that step without driving. Frozen: `Sim` never writes to it. */
const IDLE_INTENT: PlayerIntent = Object.freeze(neutralIntent());

function blankTransform(): CartTransform {
  return { position: { x: 0, y: 0, z: 0 }, heading: 0, turretYaw: 0 };
}

/** Writes `cart`'s state into `out` and returns it. */
function writeTransform(cart: Cart, out: CartTransform): CartTransform {
  const p = cart.position;
  out.position.x = p.x;
  out.position.y = p.y;
  out.position.z = p.z;
  out.heading = cart.heading;
  out.turretYaw = cart.turretYaw;
  return out;
}

/** The buffer of `pair` that is not `avoid`. */
function otherOf(pair: [CartTransform, CartTransform], avoid: CartTransform | undefined): CartTransform {
  return pair[0] === avoid ? pair[1] : pair[0];
}
