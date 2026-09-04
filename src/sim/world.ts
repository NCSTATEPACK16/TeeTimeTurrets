import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType, computeLaunchVelocity } from "../physics/Ballistics";
import { neutralIntent } from "../input/InputSource";
import type { PlayerIntent } from "../input/InputSource";
import { BUCKET_REFILL_AMMO, CART_COLLIDER, Cart, RESPAWN_DELAY_S, computeMuzzle } from "./entities/Cart";
import { BallPool, POOL_SIZE } from "./entities/BallPool";
import { BALL_RADIUS } from "./entities/ballShape";
import { createBucket, stepBucket, tryTakeBucket } from "./entities/Pickup";
import type { Bucket } from "./entities/Pickup";
import { PARTS_PER_TARGET, Target } from "./entities/Target";
import { CombatRegistry, STROKE_DAMAGE, processContacts } from "./combat";
import type { CombatContext } from "./combat";
import { applyDamage } from "./health";
import { createStats } from "./stats";
import type { HoleSpec, Vec3 } from "./course";
import { CUP_RADIUS, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaces } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";
import { BOT_CHANNEL, computeBotIntent } from "./bot";
import type { BotTarget } from "./bot";
import { hashChannel, mulberry32 } from "./rng";

export type { Vec3 } from "./course";

/** DOM-free physics module. No rendering, no input handling, no globals — just state in, state out. */
export const FIXED_DT = 1 / 60;

/**
 * Floats per transform in the render snapshot buffers: x, y, z, qx, qy, qz, qw. Flat typed
 * arrays rather than objects because these are filled every tick for up to 33 ragdoll parts and
 * 32 pooled balls, and the no-allocation rule covers the fixed tick.
 */
export const TRANSFORM_STRIDE = 7;

/** As TRANSFORM_STRIDE, plus a trailing 1/0 active flag: an idle pool slot is parked far below
 *  the world and must not be drawn where it is parked. */
export const POOL_TRANSFORM_STRIDE = 8;

/**
 * Rapier's linear damping is the ball's *air* drag only (F = -k*v, applied in flight and on
 * the ground alike). Ground roll-out is governed by ANGULAR_DAMPING instead -- see below.
 * The old 0.15 was doing both jobs and doing neither well: it cost a driver ~44% of its
 * speed over a 3.8 s flight while still leaving a 6 m/s roll ~31 s of exponential creep
 * before it crossed the rest threshold (measured 11.3 s for a 7 m putt, tools/feelProbe.ts).
 */
const LINEAR_DAMPING = 0.05;

/**
 * Turf drag, applied via spin: for a rolling sphere (I = 2/5 m r^2, v = w*r) an angular
 * damping torque decelerates translation at (2/7)*k_angular, so this contributes a
 * velocity-proportional rate of ~0.17/s on top of LINEAR_DAMPING. Launch zeroes angular
 * velocity, so it costs nothing in flight.
 *
 * Kept deliberately low. It was 3.8 while it was the *only* thing ending a roll; once
 * ROLLING_RESISTANCE existed that job moved, and the leftover 3.8 was strong enough that a
 * 2 m putt stopped 0.7 m short of the cup (measured). Velocity-proportional damping bites
 * hardest exactly where a putt lives, so it has to stay small now that it is not load-bearing.
 */
const ANGULAR_DAMPING = 0.6;

/**
 * Rolling resistance is applied as a constant deceleration crr*g against horizontal motion
 * while grounded, which is what real rolling resistance is, with crr looked up per surface
 * from sim/surfaces.ts.
 *
 * This is not a duplicate of the damping above: velocity-proportional damping decays toward
 * zero without reaching it, so on a slope the ball settles at a terminal creep speed where
 * damping balances gravity rather than stopping. At the terrain's 4.3 deg mean grade that
 * creep is ~0.48 m/s -- above any usable rest threshold -- so the ball rolls downhill
 * indefinitely (measured: a 7 m putt took 17 s to register at rest). A constant deceleration
 * has a static threshold: it holds the ball on any grade shallower than atan(crr) and brings
 * it to a full stop in finite time.
 */
const GRAVITY = 9.81;

/** Ball must be this slow and inside the cup radius to count as holed rather than lipping out. */
const HOLE_OUT_SPEED = 2.5;

/**
 * Restitution combines by averaging with the ground's 0.15, so the ball's 0.35 gives an
 * effective 0.25. Lower than the previous 0.30 mostly to cut chatter off the heightfield's
 * triangle seams, which a rolling ball hits as a normal discontinuity every ~1 m.
 */
const BALL_RESTITUTION = 0.35;

/**
 * kg/m^3. The previous 1.2 gave a 17 g ball at this radius -- roughly air. Phase 0
 * trajectories are provably unchanged by this: against a fixed collider, gravity, damping,
 * and restitution/friction impulse resolution are all mass-independent.
 *
 * 1130 is real golf-ball density, but NOT a real golf ball's mass: BALL_RADIUS is 0.15 m here,
 * arcade scale rather than a regulation 0.021 m, so this is a ~16 kg ball. Phase 3 expected to
 * have to raise it -- the worry was a featherweight ball bouncing uselessly off a multi-kg
 * ragdoll -- and the measurement said otherwise: against the heaviest target capsule (~21 kg,
 * TARGET_DENSITY in entities/Target.ts) the ratio is already ~1:1.3, well inside the <= 1:20
 * bound docs/DECISIONS.md "Ball mass" requires. Raising it would push the ball past the
 * ragdoll instead. entities/Target.test.ts asserts the ratio against the real bodies.
 *
 * Mass-independence is what would have made a change nearly free -- ball flight does not
 * change, only the ball's authority against another dynamic body. Re-run `npm run probe` after
 * changing it to confirm rather than assume.
 *
 * The CTF flag-ball is on the other side of this problem (deliberately heavy, must be struck
 * rather than carried) and wants its own density.
 */
const BALL_DENSITY = 1130;

/**
 * Rest detection. The threshold is deliberately well above zero because exponential decay
 * never actually reaches zero, and it is held for REST_HOLD_TICKS *with ground contact*
 * because at the apex of a bounce vertical velocity passes through zero -- speed alone
 * reads "at rest" in mid-air and would let the player swing at a ball still in flight.
 */
const REST_SPEED_THRESHOLD = 0.25;
const REST_HOLD_TICKS = 12;

/** Past this the ball has left the heightfield and is in free fall over nothing. */
const OUT_OF_BOUNDS_Y = -20;

/** The club a stroke uses when the caller does not name one. The cart carries its own equipped club. */
const DEFAULT_CLUB = ClubType.Driver;

/**
 * Where the cart waits at the start of a hole: behind the tee, close enough to pick the ball up
 * immediately so the hole opens with the ball already loaded on the turret. Coupled to
 * PICKUP_RANGE -- a spawn outside it makes every hole start with a pointless nudge forward.
 */
const CART_SPAWN_OFFSET = 2.5;

/**
 * How close the cart has to be to a resting ball to scoop it onto the turret.
 *
 * This is the rule that makes driving matter, and it gives one button two jobs. With the ball
 * loaded, firing plays a stroke. With the ball still out on the course, firing is a blank: the
 * recoil shoves the cart and no stroke is counted (roadmap Phase 2, "recoil as self-propulsion").
 * So you fire your ball down the fairway, then fire blanks to drive yourself after it.
 */
const PICKUP_RANGE = 3.0;

/**
 * Where the hardcoded targets stand: fractions along the tee->cup corridor, with a lateral
 * offset in metres so they are not a firing line down the middle of the fairway.
 *
 * Hardcoded for the same reason the bucket is (spec §7 of the ammo design): course-scale
 * placement is a course-generation concern, and inventing one here would be the second source of
 * truth for it. Three is enough to make hits, misses and knockdowns real.
 */
const TARGET_PLACEMENTS: readonly { along: number; lateral: number }[] = [
  { along: 0.25, lateral: 5 },
  { along: 0.5, lateral: -6 },
  { along: 0.75, lateral: 7 },
];

/** KCC tuning. Slope limits are what stop the cart driving up a wall or sticking to one. */
const CHARACTER_OFFSET = 0.02;
const CART_MAX_SLOPE_CLIMB_DEG = 45;
const CART_MIN_SLOPE_SLIDE_DEG = 32;
const CART_AUTOSTEP_HEIGHT = 0.45;
const CART_AUTOSTEP_MIN_WIDTH = 0.25;
const CART_SNAP_TO_GROUND = 0.6;

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BallTransform {
  position: Vec3;
  rotation: Quat;
}

export interface CartTransform {
  position: Vec3;
  /** Chassis yaw, radians. */
  heading: number;
  /** Turret yaw, radians, absolute in world space. */
  turretYaw: number;
}

/**
 * Everything the world owns for one cart: the state machine, the kinematic body it drives, the
 * collider that generates its contacts, and the fall speed the KCC does not integrate for us.
 *
 * Bundled rather than kept as parallel arrays because every one of these is looked up together,
 * every time. Rig 0 is always the player's; the rest are bots, in `bots` order.
 */
interface CartRig {
  readonly cart: Cart;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  fallSpeed: number;
  /**
   * The bot's own seeded stream. `null` for the player's rig, which is not AI-driven.
   * Deliberately not `readonly`: `reset()` re-seeds it so "play again" is a genuine rerun
   * rather than a continuation of the previous match's stream.
   */
  random: (() => number) | null;
  /** Reused per tick so the bot's intent costs no allocation. `null` for the player's rig. */
  readonly intentScratch: PlayerIntent | null;
}

export interface SimOptions {
  /**
   * AI carts to create. 1 in play. Tests that want the player's cart in isolation pass 0 --
   * a second cart on the course is a second source of contacts, ammo pickups and shunts.
   */
  readonly botCount?: number;
}

/** Metres past the cup, per bot. Far enough from the tee that a match opens with the bot idle. */
export const BOT_SPAWN_OFFSET = 2.5;

/**
 * Dormant since cart-only mode. Stationary is Phase 0's mechanic -- you stand at your ball and
 * swing -- and Cart is Phase 2's. `Sim` is constructed in `Cart` and there is no longer any input
 * path that changes it. Kept rather than deleted; see the note on `Sim.mode`.
 */
export enum SwingMode {
  Stationary = "stationary",
  Cart = "cart",
}

export class Sim {
  private world!: RAPIER.World;
  private ball!: RAPIER.RigidBody;
  /** Rig 0 is the player's; rigs 1.. are `bots`, in the same order. */
  private readonly rigs: CartRig[] = [];
  private controller!: RAPIER.KinematicCharacterController;
  private groundCollider!: RAPIER.Collider;
  /** The hole this sim is playing. Swapped wholesale by `loadHole`. */
  terrain: Terrain;
  surfaces: Surfaces;
  /** State from the previous fixed step, kept for render interpolation. */
  previous: BallTransform;
  /** State from the most recent fixed step. */
  current: BallTransform;
  /** Cart state from the previous fixed step, for render interpolation. */
  previousCart: CartTransform;
  /** Cart state from the most recent fixed step. */
  currentCart: CartTransform;
  /** The player's cart state machine. Read for the HUD; drive it through `step`. */
  readonly cart: Cart;
  /**
   * AI-controlled carts. An array rather than a single field because nothing in the design
   * assumes exactly one; this build creates one.
   */
  readonly bots: Cart[] = [];
  /** Bot cart transforms from the previous fixed step, for render interpolation. One per bot. */
  previousBotCarts: CartTransform[] = [];
  /** Bot cart transforms from the most recent fixed step. One per bot. */
  currentBotCarts: CartTransform[] = [];
  private ballPool!: BallPool;
  /** One hardcoded bucket for now -- course-scale placement is explicitly out of scope, see
   * docs/superpowers/specs/2026-09-02-cart-ammo-design.md §7. Populated in `create()` once the
   * hole's tee position is known; a field initializer here would run before `terrain` exists. */
  private readonly buckets: Bucket[] = [];
  /** Knockable ragdolls standing on this hole. Rebuilt by `loadHole`, stood back up by `reset`. */
  readonly targets: Target[] = [];
  /** Parts across all targets on this hole. `targets.length * PARTS_PER_TARGET`. */
  targetPartCount = 0;
  /** Target part transforms from the previous fixed step, for render interpolation. */
  previousTargetTransforms = new Float32Array(0);
  /** Target part transforms from the most recent fixed step. */
  currentTargetTransforms = new Float32Array(0);
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  previousPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Pooled ball transforms from the most recent fixed step. */
  currentPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Round-level counters. Deliberately *not* reset by `reset()` -- see sim/stats.ts. */
  readonly stats = createStats();
  /** Collider handle -> entity, so a drained collision event can be dispatched. */
  private readonly registry = new CombatRegistry();
  private eventQueue!: RAPIER.EventQueue;
  /** Built once: `processContacts` runs every tick and must not allocate its context. */
  private combatContext!: CombatContext;
  /** Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  private simTime = 0;
  /**
   * Dormant. Nothing sets this after construction: `PlayerIntent.toggleMode` is gone and the
   * stationary half of `resolveShot` is unreachable. It stays, with `Sim.ball`, `launch()` and
   * the hole-out/water-for-the-ball rules in `step()`, as the working reference for a future
   * "true golf" mode -- a deliberate exception to the delete-stale-code rule, made because that
   * mode is intended and this code is tested.
   */
  mode: SwingMode = SwingMode.Cart;
  /** True when the last shot played the ball rather than being a blank fired for propulsion. */
  lastShotWasStrike = false;
  /** Reused per-tick scratch, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  private readonly moveScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly muzzleScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly botTarget = { x: 0, z: 0, dead: false };
  /** Two, not one: the cart and the ball are at different positions within the same tick. */
  private readonly cartTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
  private readonly ballTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
  /** True when the last shot left the field and was returned to the tee. UI can read this. */
  lastShotOutOfBounds = false;
  /** True when the last shot found water and was returned with a penalty. */
  lastShotInWater = false;
  /** Strokes played on this hole, including penalties. */
  strokes = 0;
  /** Set once the ball is in the cup; further launches are ignored until reset. */
  holedOut = false;
  /** Surface under the ball as of the last tick. Drives roll-out, and later the cart and HUD. */
  surfaceUnderBall: SurfaceId = SurfaceId.Fairway;
  /** Where the ball last came to rest on playable ground -- the drop point after a hazard. */
  private lastSafePosition: Vec3;
  /** Consecutive ticks the ball has been slow and grounded; see REST_HOLD_TICKS. */
  private restTicks = REST_HOLD_TICKS;

  private constructor(terrain: Terrain, surfaces: Surfaces) {
    this.terrain = terrain;
    this.surfaces = surfaces;
    // 2 x par: the hole's par is the strokes it is worth, and the health bar is that budget
    // doubled (spec section 5). Sized here rather than at the field initializer because the
    // initializer runs before `terrain` exists.
    this.cart = new Cart({ maxHealth: 2 * terrain.spec.par });
    this.lastSafePosition = { ...terrain.teePosition };
    this.previous = restTransform(terrain);
    this.current = restTransform(terrain);
    this.previousCart = restCartTransform(terrain);
    this.currentCart = restCartTransform(terrain);
  }

  static async create(hole: HoleSpec, options: SimOptions = {}): Promise<Sim> {
    await RAPIER.init();
    const terrain = createTerrain(hole);
    const sim = new Sim(terrain, createSurfaces(hole, terrain));

    sim.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    sim.world.timestep = FIXED_DT;
    sim.buildGround();

    const tee = terrain.teePosition;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(tee.x, tee.y, tee.z)
      .setCcdEnabled(true)
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANGULAR_DAMPING);
    sim.ball = sim.world.createRigidBody(bodyDesc);

    const ballColliderDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setDensity(BALL_DENSITY)
      .setFriction(0.55)
      .setRestitution(BALL_RESTITUTION)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    // Deliberately NOT registered as a combat actor. The course ball is dormant in cart-only
    // mode (spec section 3) and only pooled balls -- fired ammo -- can hurt a cart. Registering
    // it made the player's own resting ball a hazard: the cart spawns behind the tee, so driving
    // forward ran it into the ball and cost strokes, which at 2 x par health is lethal. An
    // unregistered handle falls through processContacts's own `if (!a || !b) return`.
    sim.world.createCollider(ballColliderDesc, sim.ball);

    sim.controller = sim.world.createCharacterController(CHARACTER_OFFSET);
    sim.controller.setUp({ x: 0, y: 1, z: 0 });
    sim.controller.setMaxSlopeClimbAngle((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
    sim.controller.setMinSlopeSlideAngle((CART_MIN_SLOPE_SLIDE_DEG * Math.PI) / 180);
    sim.controller.enableAutostep(CART_AUTOSTEP_HEIGHT, CART_AUTOSTEP_MIN_WIDTH, true);
    sim.controller.enableSnapToGround(CART_SNAP_TO_GROUND);
    // Phase 3.5's flag-ball has to be shovable by the cart, and a KCC ignores dynamic bodies
    // unless told otherwise. Enabling it now costs nothing -- the only dynamic body today is
    // the ball, and nudging your own ball by driving into it is correct behaviour anyway.
    sim.controller.setApplyImpulsesToDynamicBodies(true);

    sim.addCartRig(sim.cart, cartSpawnPosition(terrain), null);

    // The closure reads sim.terrain live rather than closing over `terrain`, so it keeps
    // checking against the correct hole's height field after loadHole() reassigns sim.terrain.
    sim.ballPool = new BallPool(sim.world, (x, z) => sim.terrain.heightAt(x, z));
    sim.buckets.push(createBucket(tee.x + 10, tee.z));

    sim.eventQueue = new RAPIER.EventQueue(true);
    sim.combatContext = {
      registry: sim.registry,
      stats: sim.stats,
      onCartKilled: (cart) => sim.killCart(cart),
    };
    for (const pooled of sim.ballPool.all) {
      sim.registry.registerBall(pooled.body.collider(0).handle, pooled.body);
    }
    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      const bot = new Cart({ maxHealth: 2 * hole.par });
      sim.bots.push(bot);
      sim.addCartRig(
        bot,
        botSpawnPosition(terrain, i),
        mulberry32(hashChannel(hole.seed, hole.index, BOT_CHANNEL, i)),
      );
    }
    sim.buildTargets();

    sim.syncCurrent();
    sim.previous = sim.current;
    sim.syncCurrentCart();
    sim.previousCart = sim.currentCart;
    sim.previousBotCarts = sim.currentBotCarts.slice();
    sim.syncCurrentPool();
    sim.previousPoolTransforms.set(sim.currentPoolTransforms);
    return sim;
  }

  /**
   * Builds the heightfield collider for the current terrain. Split out of `create` because
   * `loadHole` has to redo exactly this and nothing else about the world.
   */
  private buildGround(): void {
    const spec = this.terrain.spec;
    const groundDesc = RAPIER.ColliderDesc.heightfield(
      spec.cells,
      spec.cells,
      this.terrain.buildHeightfield(),
      { x: spec.fieldSize, y: 1, z: spec.fieldSize },
    )
      .setFriction(0.8)
      .setRestitution(0.15);
    this.groundCollider = this.world.createCollider(groundDesc);
  }

  /**
   * Creates one cart's body and collider at `spawn`, registers it for contact dispatch, and
   * files the rig. Every cart -- the player's and every bot's -- goes through here, so a bot is
   * physically identical to the player rather than a cheaper approximation of one.
   */
  private addCartRig(cart: Cart, spawn: Vec3, random: (() => number) | null): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        // Rapier computes no contacts between two kinematic bodies by default, and every cart
        // here is kinematic -- without this, cart-vs-cart shunting generates no events at all.
        .setActiveCollisionTypes(
          RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
        ),
      body,
    );
    cart.position.x = spawn.x;
    cart.position.y = spawn.y;
    cart.position.z = spawn.z;
    this.registry.registerCart(collider.handle, cart);
    this.rigs.push({
      cart,
      body,
      collider,
      fallSpeed: 0,
      random,
      intentScratch: random === null ? null : neutralIntent(),
    });
  }

  /**
   * Stands the hole's targets up along the tee->cup corridor and registers their colliders so a
   * contact against one can be dispatched. Split out because `loadHole` has to redo exactly this:
   * a target's pose is baked at construction, so a new hole's terrain means new targets rather
   * than moved ones.
   */
  private buildTargets(): void {
    for (const target of this.targets) {
      this.registry.unregisterTarget(target);
      target.dispose();
    }
    this.targets.length = 0;

    const tee = this.terrain.teePosition;
    const cup = this.terrain.cupPosition;
    const dx = cup.x - tee.x;
    const dz = cup.z - tee.z;
    const length = Math.hypot(dx, dz) || 1;
    // Unit vector across the corridor, for the lateral offset.
    const sideX = -dz / length;
    const sideZ = dx / length;

    for (const placement of TARGET_PLACEMENTS) {
      const x = tee.x + dx * placement.along + sideX * placement.lateral;
      const z = tee.z + dz * placement.along + sideZ * placement.lateral;
      const target = new Target(this.world, { x, y: this.terrain.heightAt(x, z), z });
      this.targets.push(target);
      this.registry.registerTarget(target);
    }

    this.targetPartCount = this.targets.length * PARTS_PER_TARGET;
    const floats = this.targetPartCount * TRANSFORM_STRIDE;
    if (this.currentTargetTransforms.length !== floats) {
      this.currentTargetTransforms = new Float32Array(floats);
      this.previousTargetTransforms = new Float32Array(floats);
    }
    this.syncCurrentTargets();
    this.previousTargetTransforms.set(this.currentTargetTransforms);
  }

  /**
   * Death: the cart is out of the world for `RESPAWN_DELAY_S` and comes back at the spawn point.
   * Guarded on `dead` so two lethal contacts in one tick do not restart the timer.
   *
   * No stroke is charged here. The hit that took the last point of HP already counted its own
   * stroke against `cart.strokesTaken`; charging again for the death would double it.
   */
  private killCart(cart: Cart): void {
    if (cart.dead) return;
    cart.dead = true;
    cart.respawnTimer = RESPAWN_DELAY_S;
  }

  /**
   * Swap in a different hole. The ball, cart and controller are reused -- only the terrain,
   * the surfaces and the ground collider are rebuilt, then everything is re-teed.
   *
   * Nothing in this phase calls it during play: `main.ts` loads hole 0 and stays there, and the
   * renderer's ground mesh is built once at construction, so advancing a round mid-session is
   * Phase 1.75's job (spec §9). It exists and is tested now because the collider swap is the
   * part that is easy to get wrong later.
   */
  loadHole(spec: HoleSpec): void {
    this.world.removeCollider(this.groundCollider, false);
    this.terrain = createTerrain(spec);
    this.surfaces = createSurfaces(spec, this.terrain);
    this.buildGround();
    this.lastSafePosition = { ...this.terrain.teePosition };

    // Stale in-flight/landed balls and the bucket's old-hole position must not survive into the
    // new hole -- otherwise a landed ball at the previous hole's coordinates could still be
    // picked up for ammo here, and the bucket would sit wherever the last hole put it.
    this.ballPool.releaseAll();
    this.syncCurrentPool();
    this.previousPoolTransforms.set(this.currentPoolTransforms);
    const tee = this.terrain.teePosition;
    for (const bucket of this.buckets) {
      bucket.position = { x: tee.x + 10, z: tee.z };
    }
    this.buildTargets();

    // A new hole can bring a different par, and the health bar is sized from it.
    for (const rig of this.rigs) rig.cart.setMaxHealth(2 * this.terrain.spec.par);
    this.reset();
  }

  /**
   * Advance exactly one fixed tick. Call in a while-loop from an accumulator, never per render
   * frame. The intent defaults to neutral so headless callers that only care about ball flight
   * (tools/feelProbe.ts) do not have to synthesise one.
   *
   * The cart is stepped before `world.step()` on purpose: `computeColliderMovement` is a query
   * against the current world, and `setNextKinematicTranslation` is consumed by the step that
   * follows it.
   */
  step(intent: PlayerIntent = IDLE_INTENT): void {
    const swapTargets = this.previousTargetTransforms;
    this.previousTargetTransforms = this.currentTargetTransforms;
    this.currentTargetTransforms = swapTargets;

    const swapPool = this.previousPoolTransforms;
    this.previousPoolTransforms = this.currentPoolTransforms;
    this.currentPoolTransforms = swapPool;

    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) {
      this.previousBotCarts[i] = this.currentBotCarts[i]!;
    }
    this.stepCart(intent);
    this.syncCurrentCart();

    this.previous = this.current;
    // Stepping with the queue is what fills it; combat.ts drains it immediately afterwards, so
    // no contact is ever carried into the following tick.
    this.world.step(this.eventQueue);
    this.syncCurrent();
    processContacts(this.eventQueue, this.combatContext);
    for (const target of this.targets) target.step();
    this.syncCurrentTargets();
    this.syncCurrentPool();

    // The heightfield has no walls, so a ball past its edge free-falls forever and never
    // satisfies isResting() -- the player would be locked out of swinging with only a
    // manual reset to recover. Returning to the tee is also the golf rule for out of bounds.
    if (this.isPastFieldEdge()) {
      this.dropAtLastSafePosition();
      this.lastShotOutOfBounds = true;
      return;
    }

    const p = this.current.position;
    this.surfaceUnderBall = this.surfaces.surfaceAt(p.x, p.z);

    if (this.isInCup()) {
      this.holedOut = true;
      this.restTicks = REST_HOLD_TICKS;
      return;
    }

    const grounded = this.isGrounded();
    if (grounded) this.applySurfaceResistance();

    // Water is stroke-and-distance: one penalty, then drop where the ball was last safe.
    // Checked only once settled so the ball is allowed to skip across a pond edge first.
    const v = this.ball.linvel();
    const slow = Math.hypot(v.x, v.y, v.z) < REST_SPEED_THRESHOLD;
    if (this.surfaceUnderBall === SurfaceId.Water && grounded && slow) {
      this.strokes += 1;
      this.dropAtLastSafePosition();
      this.lastShotInWater = true;
      return;
    }

    this.restTicks = slow && grounded ? this.restTicks + 1 : 0;
    if (this.restTicks === REST_HOLD_TICKS && !SURFACES[this.surfaceUnderBall].isHazard) {
      this.lastSafePosition = { x: p.x, y: p.y, z: p.z };
    }
  }

  /**
   * Per-tick world bookkeeping that belongs to no single cart, then one `stepRig` call per cart.
   * Split that way so the pool and the buckets tick exactly once however many carts are in play.
   */
  private stepCart(intent: PlayerIntent): void {
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
    if (rig.random === null || rig.intentScratch === null) return playerIntent;
    computeBotIntent(rig.cart, this.botTargetScratch(), FIXED_DT, rig.random, rig.intentScratch);
    return rig.intentScratch;
  }

  /**
   * The player, as the only thing a bot engages in this build. Written into one reused object
   * per the no-allocation rule; a bot never sees the player's `Cart` itself.
   */
  private botTargetScratch(): BotTarget {
    this.botTarget.x = this.cart.position.x;
    this.botTarget.z = this.cart.position.z;
    this.botTarget.dead = this.cart.dead;
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
    cart.step(intent, FIXED_DT, this.cartTuningScratch);
    this.moveCartBody(rig);
    this.checkCartWater(rig);

    for (const bucket of this.buckets) {
      if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) cart.addAmmo(BUCKET_REFILL_AMMO);
    }
    for (const landed of this.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
      cart.addAmmo(1);
      this.ballPool.release(landed);
    }

    if (cart.shot.fired) {
      cart.shot.fired = false;
      this.resolveShot(cart);
    }
  }

  /**
   * Counts one cart's respawn delay down and puts it back at its own spawn point when it
   * expires. Intent is not read at all while dead -- drive, steer, aim, fire and club selection
   * are all ignored -- so ammo, reload and position are frozen for the duration.
   */
  private stepRespawn(rig: CartRig): void {
    rig.cart.respawnTimer -= FIXED_DT;
    if (rig.cart.respawnTimer > 0) return;

    const spawn = this.spawnFor(rig);
    rig.cart.position.x = spawn.x;
    rig.cart.position.y = spawn.y;
    rig.cart.position.z = spawn.z;
    rig.cart.revive();
    rig.fallSpeed = 0;
    rig.body.setTranslation(spawn, true);
  }

  /** Rig 0 spawns behind the tee; a bot spawns past the cup, one offset per bot index. */
  private spawnFor(rig: CartRig): Vec3 {
    const index = this.rigs.indexOf(rig);
    return index <= 0 ? cartSpawnPosition(this.terrain) : botSpawnPosition(this.terrain, index - 1);
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

    this.controller.computeColliderMovement(rig.collider, this.moveScratch);
    const corrected = this.controller.computedMovement();

    const p = rig.cart.position;
    const half = this.terrain.spec.fieldSize / 2 - CART_COLLIDER.radius;
    p.x = Math.min(half, Math.max(-half, p.x + corrected.x));
    p.y += corrected.y;
    p.z = Math.min(half, Math.max(-half, p.z + corrected.z));

    if (this.controller.computedGrounded()) rig.fallSpeed = 0;
    rig.body.setNextKinematicTranslation(p);
  }

  /**
   * A cart in the water costs a stroke and is dropped back where it was last on dry land --
   * the same stroke-and-distance shape the ball's own water rule uses, applied to the driver.
   *
   * Edge-triggered on `wasInWater`, so a cart nosing into a pond pays once rather than once per
   * tick. Each cart's flag is its own state, so two carts entering water on the same tick are
   * independent by construction and need no ordering rule.
   *
   * Runs inside `stepRig`'s alive branch, which `stepRespawn` returns before -- a dead cart is
   * out of the world and pays nothing.
   */
  private checkCartWater(rig: CartRig): void {
    const cart = rig.cart;
    const p = cart.position;
    const inWater = this.surfaces.surfaceAt(p.x, p.z) === SurfaceId.Water;

    if (!inWater) {
      cart.wasInWater = false;
      // Recorded every dry tick. A cart does not bounce the way a ball does, so this needs none
      // of the ball's REST_HOLD_TICKS debounce -- wherever it is now is somewhere it can be put
      // back down.
      cart.lastSafePosition.x = p.x;
      cart.lastSafePosition.y = p.y;
      cart.lastSafePosition.z = p.z;
      return;
    }

    if (cart.wasInWater) return;
    cart.wasInWater = true;

    cart.strokesTaken += 1;
    if (applyDamage(cart.health, STROKE_DAMAGE)) this.killCart(cart);

    const safe = cart.lastSafePosition;
    p.x = safe.x;
    p.y = safe.y;
    p.z = safe.z;
    cart.speed = 0;
    rig.fallSpeed = 0;
    rig.body.setTranslation(p, true);
  }

  /**
   * Cart mode and stationary mode resolve a shot through entirely separate paths now: cart
   * mode spawns from the ammo-gated BallPool, stationary mode plays the single Sim.ball where
   * it lies. See docs/superpowers/specs/2026-09-02-cart-ammo-design.md §1 for why they aren't
   * unified. The stationary half below is unreachable -- `mode` is never anything but `Cart` --
   * and is kept as the reference implementation of the stroke-play swing; see the note on
   * `Sim.mode`.
   *
   * Any cart reaches this now that carts are rigs, but `Sim.stats`, `lastShotWasStrike`,
   * `Sim.ball` and `Sim.strokes` are all single-player state -- `stats.shotsFired` is the
   * accuracy denominator the results screen reports. So only the player's shot may write them,
   * and the stationary branch, which plays the player's own course ball, is his alone.
   */
  private resolveShot(cart: Cart): void {
    const isPlayer = cart === this.cart;
    if (this.mode === SwingMode.Cart) {
      // No ball is scooped off the course here and none ever will be: the ammo fork replaced
      // "drive over the ball to load it" with a pooled-ball ammo counter, and this branch never
      // touches Sim.ball. The old ballLoaded/ballInReach pair described the retired mechanic and
      // made the course ball vanish onto a turret that could not play it (BACKLOG #16d).
      if (!cart.shot.hasBall) {
        if (isPlayer) this.lastShotWasStrike = false;
        return;
      }

      const pooled = this.ballPool.acquire();
      if (!pooled) {
        // All POOL_SIZE bodies are in flight simultaneously -- an extreme, likely
        // untestable-in-practice case (spec §6). Cart.fire() already decremented ammo on the
        // assumption a ball would spawn; refund it so this degrades to a true no-op rather
        // than costing ammo for nothing. No ball actually spawned, so this is not a strike.
        cart.addAmmo(1);
        if (isPlayer) this.lastShotWasStrike = false;
        return;
      }

      if (isPlayer) {
        this.lastShotWasStrike = true;
        // "A shot fired" for accuracy purposes is a ball actually leaving the muzzle -- distinct
        // from ammo's own decrement, which a 0-ammo blank also triggers.
        this.stats.shotsFired += 1;
      }
      computeMuzzle(cart, this.muzzleScratch);
      pooled.body.setTranslation(this.muzzleScratch, true);
      pooled.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      pooled.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      pooled.body.setLinvel(
        computeLaunchVelocity(cart.shot.club, cart.shot.charge01, cart.shot.yaw),
        true,
      );
      return;
    }

    // Stationary mode plays Sim.ball, and there is exactly one of those: the player's. A bot has
    // no course ball to strike, so its trigger pull ends here rather than launching the player's.
    if (!isPlayer) return;

    const playable = this.isResting() && !this.holedOut;
    this.lastShotWasStrike = playable;
    if (!playable) return;

    this.launch(cart.shot.yaw, cart.shot.charge01, cart.shot.club);
  }

  /** Where the ball is riding when loaded on the turret. The scoop-onto-the-turret mechanic is
   * retired (#16d), so the course ball is now always drawn and this no longer trades off
   * against a course position -- it just answers where the ammo-round sprite sits. */
  muzzle(out: Vec3): void {
    computeMuzzle(this.cart, out);
  }

  /**
   * Constant deceleration against horizontal motion plus a per-surface bounce cut, clamped so
   * it stops the ball rather than reversing it. Written as direct velocity changes instead of
   * impulses because the result is then mass-independent and exactly predictable per tick --
   * useful for a module that has to stay reproducible on an authoritative server.
   *
   * Per-surface restitution/friction cannot go on the collider: there is one heightfield
   * collider for the whole course, so a material that varies by position has to be applied
   * here. `bounceScale` is what makes a bunker read as sand rather than as slow fairway.
   */
  private applySurfaceResistance(): void {
    const p = this.current.position;
    const tuning = this.ballTuningScratch;
    this.surfaces.tuningAt(p.x, p.z, tuning);
    const v = this.ball.linvel();

    const horizontalSpeed = Math.hypot(v.x, v.z);
    const speedDrop = tuning.rolling * GRAVITY * FIXED_DT;
    const scale = horizontalSpeed < 1e-4 ? 1 : Math.max(0, 1 - speedDrop / horizontalSpeed);
    const bounceY = v.y > 0 ? v.y * tuning.bounceScale : v.y;

    this.ball.setLinvel({ x: v.x * scale, y: bounceY, z: v.z * scale }, true);
  }

  /** Ball is inside the cup mouth and slow enough to drop rather than lip out. */
  private isInCup(): boolean {
    const p = this.current.position;
    const cup = this.terrain.cupPosition;
    if (Math.hypot(p.x - cup.x, p.z - cup.z) > CUP_RADIUS) return false;
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.y, v.z) < HOLE_OUT_SPEED;
  }

  private dropAtLastSafePosition(): void {
    this.ball.setTranslation(this.lastSafePosition, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncCurrent();
    this.previous = this.current;
    this.restTicks = REST_HOLD_TICKS;
  }

  /** yawRadians 0 aims down +X. power is a 0..1 charge fraction from hold duration. */
  launch(yawRadians: number, power: number, club: ClubType = DEFAULT_CLUB): void {
    if (this.holedOut) return;
    const velocity = computeLaunchVelocity(club, power, yawRadians);
    this.ball.setLinvel(velocity, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.strokes += 1;
    this.restTicks = 0;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
  }

  /** Full reset back to the tee: new hole, stroke counts and every cart's position included. */
  reset(): void {
    this.lastSafePosition = { ...this.terrain.teePosition };
    this.dropAtLastSafePosition();
    this.strokes = 0;
    this.holedOut = false;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
    this.lastShotWasStrike = false;

    for (const rig of this.rigs) {
      const spawn = this.spawnFor(rig);
      rig.cart.position.x = spawn.x;
      rig.cart.position.y = spawn.y;
      rig.cart.position.z = spawn.z;
      rig.cart.heading = 0;
      rig.cart.turretOffset = 0;
      // Health, death, momentum and the match score all clear here: a new hole starts alive, at
      // full HP, standing still, on nothing. Ammo deliberately survives -- it is a round-spanning
      // resource, HP is not. `stats` survives too, being round-level (sim/stats.ts).
      rig.cart.revive();
      rig.cart.clearStrokes();
      rig.cart.wasInWater = false;
      rig.fallSpeed = 0;
      rig.body.setTranslation(spawn, true);
      if (rig.random !== null) {
        rig.random = mulberry32(
          hashChannel(this.terrain.spec.seed, this.terrain.spec.index, BOT_CHANNEL, this.rigs.indexOf(rig) - 1),
        );
      }
    }

    for (const target of this.targets) target.reset();
    this.syncCurrentTargets();
    this.previousTargetTransforms.set(this.currentTargetTransforms);
    this.syncCurrentCart();
    this.previousCart = this.currentCart;
    this.previousBotCarts = this.currentBotCarts.slice();
  }

  isResting(): boolean {
    return this.restTicks >= REST_HOLD_TICKS;
  }

  /** Ball is within one radius of the terrain surface, i.e. not mid-bounce. */
  private isGrounded(): boolean {
    const p = this.current.position;
    return p.y - this.terrain.heightAt(p.x, p.z) < BALL_RADIUS * 2;
  }

  private isPastFieldEdge(): boolean {
    const p = this.current.position;
    const half = this.terrain.spec.fieldSize / 2;
    return Math.abs(p.x) > half || Math.abs(p.z) > half || p.y < OUT_OF_BOUNDS_Y;
  }

  private syncCurrent(): void {
    const t = this.ball.translation();
    const r = this.ball.rotation();
    this.current = {
      position: { x: t.x, y: t.y, z: t.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }

  /**
   * Snapshots each cart's own position rather than its rigid body's: a kinematic body only moves
   * when `world.step()` consumes the queued translation, so reading the body here would render
   * every cart one tick behind everything else.
   */
  private syncCurrentCart(): void {
    this.currentCart = cartTransformOf(this.cart);
    for (let i = 0; i < this.bots.length; i++) {
      this.currentBotCarts[i] = cartTransformOf(this.bots[i]!);
    }
  }

  /**
   * Flattens every target part's body transform into the current buffer. Reads Rapier directly
   * rather than going through Target, because Target owns no snapshot of its own and the render
   * layer must never touch a Rapier body itself.
   */
  private syncCurrentTargets(): void {
    const buffer = this.currentTargetTransforms;
    let i = 0;
    for (const target of this.targets) {
      for (const part of target.parts) {
        const t = part.body.translation();
        const r = part.body.rotation();
        buffer[i] = t.x;
        buffer[i + 1] = t.y;
        buffer[i + 2] = t.z;
        buffer[i + 3] = r.x;
        buffer[i + 4] = r.y;
        buffer[i + 5] = r.z;
        buffer[i + 6] = r.w;
        i += TRANSFORM_STRIDE;
      }
    }
  }

  /**
   * Flattens the pool into the current buffer. An idle ball is parked far below the world, so the
   * active flag is what stops the renderer drawing thirty-two spheres at y = -1000.
   *
   * A slot transitioning idle -> active this tick also gets `previousPoolTransforms` seeded with
   * the same transform. Without this, `previous` for that slot is stale -- world origin for a
   * never-used slot, or wherever the slot's last occupant landed for a reused one -- and
   * `interpolateTransforms` (main.ts) would lerp the ball in from that stale point on its spawn
   * frame even though the active flag (copied, not lerped) already reads 1.
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
        previous[flat] = buffer[flat]!;
        previous[flat + 1] = buffer[flat + 1]!;
        previous[flat + 2] = buffer[flat + 2]!;
        previous[flat + 3] = buffer[flat + 3]!;
        previous[flat + 4] = buffer[flat + 4]!;
        previous[flat + 5] = buffer[flat + 5]!;
        previous[flat + 6] = buffer[flat + 6]!;
        previous[flat + 7] = 1;
      }
    }
  }
}

/** Neutral intent for callers that only care about ball flight. Frozen: `Sim` never writes to it. */
const IDLE_INTENT: PlayerIntent = Object.freeze(neutralIntent());

function restTransform(terrain: Terrain): BallTransform {
  return { position: { ...terrain.teePosition }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}

/** Behind the tee along -X, so a new hole never spawns the cart sitting on its own ball. */
function cartSpawnPosition(terrain: Terrain): Vec3 {
  const x = terrain.teePosition.x - CART_SPAWN_OFFSET;
  const z = terrain.teePosition.z;
  return { x, y: terrain.heightAt(x, z) + CART_COLLIDER.groundOffset, z };
}

/**
 * Beyond the cup along +X, mirroring `cartSpawnPosition`'s "behind the tee" placement. Chosen so
 * a match opens with the bot further from the player than BOT_ENGAGE_RANGE: on the fixed hole
 * that is ~93 m against a 40 m engagement range, so the bot idles until the player drives at it
 * rather than opening fire from the tee.
 */
function botSpawnPosition(terrain: Terrain, index: number): Vec3 {
  const x = terrain.cupPosition.x + BOT_SPAWN_OFFSET * (index + 1);
  const z = terrain.cupPosition.z;
  return { x, y: terrain.heightAt(x, z) + CART_COLLIDER.groundOffset, z };
}

function restCartTransform(terrain: Terrain): CartTransform {
  return { position: cartSpawnPosition(terrain), heading: 0, turretYaw: 0 };
}

function cartTransformOf(cart: Cart): CartTransform {
  const p = cart.position;
  return {
    position: { x: p.x, y: p.y, z: p.z },
    heading: cart.heading,
    turretYaw: cart.turretYaw,
  };
}
