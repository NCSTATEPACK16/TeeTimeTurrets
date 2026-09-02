import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType, computeLaunchVelocity } from "../physics/Ballistics";
import { neutralIntent } from "../input/InputSource";
import type { PlayerIntent } from "../input/InputSource";
import { BUCKET_REFILL_AMMO, CART_COLLIDER, Cart, RESPAWN_DELAY_S, computeMuzzle } from "./entities/Cart";
import { BallPool } from "./entities/BallPool";
import { createBucket, stepBucket, tryTakeBucket } from "./entities/Pickup";
import type { Bucket } from "./entities/Pickup";
import { Target } from "./entities/Target";
import { CombatRegistry, processContacts } from "./combat";
import type { CombatContext } from "./combat";
import { createStats } from "./stats";
import type { HoleSpec, Vec3 } from "./course";
import { CUP_RADIUS, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaces } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";

export type { Vec3 } from "./course";

/** DOM-free physics module. No rendering, no input handling, no globals — just state in, state out. */
export const FIXED_DT = 1 / 60;

const BALL_RADIUS = 0.15;

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
 * Both modes are kept rather than one replacing the other. Stationary is Phase 0's mechanic --
 * you stand at your ball and swing. Cart is Phase 2's -- you drive to it and the turret does the
 * hitting. They share one swing state machine (the cart's) so charge, reload and club selection
 * cannot drift apart between them; stationary mode simply ignores the driving axes and the
 * strike-range check, because you are by definition standing at the ball.
 */
export enum SwingMode {
  Stationary = "stationary",
  Cart = "cart",
}

export class Sim {
  private world!: RAPIER.World;
  private ball!: RAPIER.RigidBody;
  private cartBody!: RAPIER.RigidBody;
  private cartCollider!: RAPIER.Collider;
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
  /** The cart's authoritative state machine. Read for the HUD; drive it through `step`. */
  readonly cart = new Cart();
  private ballPool!: BallPool;
  /** One hardcoded bucket for now -- course-scale placement is explicitly out of scope, see
   * docs/superpowers/specs/2026-09-02-cart-ammo-design.md §7. Populated in `create()` once the
   * hole's tee position is known; a field initializer here would run before `terrain` exists. */
  private readonly buckets: Bucket[] = [];
  /** Knockable ragdolls standing on this hole. Rebuilt by `loadHole`, stood back up by `reset`. */
  readonly targets: Target[] = [];
  /** Round-level counters. Deliberately *not* reset by `reset()` -- see sim/stats.ts. */
  readonly stats = createStats();
  /** Collider handle -> entity, so a drained collision event can be dispatched. */
  private readonly registry = new CombatRegistry();
  private eventQueue!: RAPIER.EventQueue;
  /** Built once: `processContacts` runs every tick and must not allocate its context. */
  private combatContext!: CombatContext;
  /** Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  private simTime = 0;
  mode: SwingMode = SwingMode.Stationary;
  /** True when the cart is close enough to a resting ball to scoop it up. */
  ballInReach = false;
  /**
   * True when the ball is riding the turret rather than lying on the course. While loaded it is
   * rendered at the muzzle and a shot plays it; while not loaded a shot is a blank.
   */
  ballLoaded = false;
  /** True when the last shot played the ball rather than being a blank fired for propulsion. */
  lastShotWasStrike = false;
  /** Vertical velocity of the cart, integrated here because a KCC has no gravity of its own. */
  private cartFallSpeed = 0;
  /** Reused per-tick scratch, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  private readonly moveScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly muzzleScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly parkedScratch: PlayerIntent = neutralIntent();
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
    this.lastSafePosition = { ...terrain.teePosition };
    this.previous = restTransform(terrain);
    this.current = restTransform(terrain);
    this.previousCart = restCartTransform(terrain);
    this.currentCart = restCartTransform(terrain);
  }

  static async create(hole: HoleSpec): Promise<Sim> {
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
    const ballCollider = sim.world.createCollider(ballColliderDesc, sim.ball);

    const spawn = cartSpawnPosition(terrain);
    sim.cartBody = sim.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    sim.cartCollider = sim.world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        // Rapier computes no contacts between two kinematic bodies by default, so cart-vs-cart
        // shunting would generate no events at all once a second cart exists. Enabling it now
        // costs nothing -- there is exactly one cart today.
        .setActiveCollisionTypes(
          RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
        ),
      sim.cartBody,
    );
    sim.cart.position.x = spawn.x;
    sim.cart.position.y = spawn.y;
    sim.cart.position.z = spawn.z;

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
    sim.registry.registerBall(ballCollider.handle, sim.ball);
    for (const pooled of sim.ballPool.all) {
      sim.registry.registerBall(pooled.body.collider(0).handle, pooled.body);
    }
    sim.registry.registerCart(sim.cartCollider.handle, sim.cart);
    sim.buildTargets();

    sim.syncCurrent();
    sim.previous = sim.current;
    sim.syncCurrentCart();
    sim.previousCart = sim.currentCart;
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
  }

  /**
   * Death: a stroke penalty and a wait, mirroring the water-hazard rule rather than inventing a
   * second shape for "you lost the ball/the cart." Guarded on `dead` so two lethal contacts in
   * one tick cost one stroke, not two.
   */
  private killCart(cart: Cart): void {
    if (cart.dead) return;
    cart.dead = true;
    cart.respawnTimer = RESPAWN_DELAY_S;
    this.strokes += 1;
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
    const tee = this.terrain.teePosition;
    for (const bucket of this.buckets) {
      bucket.position = { x: tee.x + 10, z: tee.z };
    }
    this.buildTargets();

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
    this.previousCart = this.currentCart;
    this.stepCart(intent);
    this.syncCurrentCart();

    this.previous = this.current;
    // Stepping with the queue is what fills it; combat.ts drains it immediately afterwards, so
    // no contact is ever carried into the following tick.
    this.world.step(this.eventQueue);
    this.syncCurrent();
    processContacts(this.eventQueue, this.combatContext);
    for (const target of this.targets) target.step();

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
   * Intent -> cart state -> body movement -> shot resolution, in that order. Runs in both modes:
   * stationary mode zeroes the driving axes rather than skipping the call, so charge, reload and
   * club selection go through exactly one state machine and cannot drift between modes.
   */
  private stepCart(intent: PlayerIntent): void {
    // The world keeps running while the cart is out of it: balls already in flight land, and
    // bucket cooldowns keep ticking. Only the cart is frozen.
    this.simTime += FIXED_DT;
    this.ballPool.step(FIXED_DT, this.simTime);
    for (const bucket of this.buckets) stepBucket(bucket, FIXED_DT);

    if (this.cart.dead) {
      this.stepRespawn();
      return;
    }

    if (intent.toggleMode) {
      this.mode = this.mode === SwingMode.Cart ? SwingMode.Stationary : SwingMode.Cart;
    }
    if (intent.selectClub !== null) this.cart.selectClub(intent.selectClub);

    const driving = this.mode === SwingMode.Cart;
    const c = this.cart.position;
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    this.cart.step(driving ? intent : this.parkedIntent(intent), FIXED_DT, this.cartTuningScratch);

    if (driving) this.moveCartBody();

    const b = this.current.position;
    this.ballInReach = Math.hypot(b.x - c.x, b.z - c.z) <= PICKUP_RANGE;
    // The ball only rides the turret while it is settled: scooping one still rolling would let
    // a player cancel their own shot by chasing it.
    this.ballLoaded = driving && this.ballInReach && this.isResting() && !this.holedOut;

    for (const bucket of this.buckets) {
      if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) this.cart.addAmmo(BUCKET_REFILL_AMMO);
    }
    for (const landed of this.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
      this.cart.addAmmo(1);
      this.ballPool.release(landed);
    }

    if (this.cart.shot.fired) {
      this.cart.shot.fired = false;
      this.resolveShot();
    }
  }

  /**
   * Counts the respawn delay down and puts the cart back at the tee-adjacent spawn point when it
   * expires. Intent is not read at all while dead -- drive, steer, aim, fire, club selection and
   * the mode toggle are all ignored -- so ammo, reload and position are frozen for the duration.
   */
  private stepRespawn(): void {
    this.ballLoaded = false;
    this.ballInReach = false;
    this.cart.respawnTimer -= FIXED_DT;
    if (this.cart.respawnTimer > 0) return;

    const spawn = cartSpawnPosition(this.terrain);
    this.cart.position.x = spawn.x;
    this.cart.position.y = spawn.y;
    this.cart.position.z = spawn.z;
    this.cart.revive();
    this.cartFallSpeed = 0;
    this.cartBody.setTranslation(spawn, true);
  }

  /** The player's intent with the driving axes removed, reusing one object per the no-alloc rule. */
  private parkedIntent(intent: PlayerIntent): PlayerIntent {
    const parked = this.parkedScratch;
    parked.throttle = 0;
    parked.steer = 0;
    parked.brake = false;
    parked.aimDelta = intent.aimDelta;
    parked.fire = intent.fire;
    parked.selectClub = null;
    parked.toggleMode = false;
    return parked;
  }

  /**
   * A KCC has no gravity and receives no impulses, so both are this class's problem: fall speed
   * is integrated here, and the recoil that shoves the cart arrives already baked into
   * `cart.desiredTranslation` as a velocity term the cart decays itself.
   *
   * `computedMovement()` allocates inside the binding. That is the one unavoidable per-tick
   * allocation in this loop; everything on our side of the call reuses `moveScratch`.
   */
  private moveCartBody(): void {
    this.cartFallSpeed -= GRAVITY * FIXED_DT;
    this.moveScratch.x = this.cart.desiredTranslation.x;
    this.moveScratch.y = this.cartFallSpeed * FIXED_DT;
    this.moveScratch.z = this.cart.desiredTranslation.z;

    this.controller.computeColliderMovement(this.cartCollider, this.moveScratch);
    const corrected = this.controller.computedMovement();

    const p = this.cart.position;
    const half = this.terrain.spec.fieldSize / 2 - CART_COLLIDER.radius;
    p.x = Math.min(half, Math.max(-half, p.x + corrected.x));
    p.y += corrected.y;
    p.z = Math.min(half, Math.max(-half, p.z + corrected.z));

    if (this.controller.computedGrounded()) this.cartFallSpeed = 0;
    this.cartBody.setNextKinematicTranslation(p);
  }

  /**
   * Cart mode and stationary mode resolve a shot through entirely separate paths now: cart
   * mode spawns from the ammo-gated BallPool, stationary mode plays the single Sim.ball where
   * it lies. See docs/superpowers/specs/2026-09-02-cart-ammo-design.md §1 for why they aren't
   * unified.
   */
  private resolveShot(): void {
    if (this.mode === SwingMode.Cart) {
      if (!this.cart.shot.hasBall) {
        this.lastShotWasStrike = false;
        return;
      }

      const pooled = this.ballPool.acquire();
      if (!pooled) {
        // All POOL_SIZE bodies are in flight simultaneously -- an extreme, likely
        // untestable-in-practice case (spec §6). Cart.fire() already decremented ammo on the
        // assumption a ball would spawn; refund it so this degrades to a true no-op rather
        // than costing ammo for nothing. No ball actually spawned, so this is not a strike.
        this.cart.addAmmo(1);
        this.lastShotWasStrike = false;
        return;
      }

      this.lastShotWasStrike = true;
      // "A shot fired" for accuracy purposes is a ball actually leaving the muzzle -- distinct
      // from ammo's own decrement, which a 0-ammo blank also triggers.
      this.stats.shotsFired += 1;
      computeMuzzle(this.cart, this.muzzleScratch);
      pooled.body.setTranslation(this.muzzleScratch, true);
      pooled.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      pooled.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      pooled.body.setLinvel(
        computeLaunchVelocity(this.cart.shot.club, this.cart.shot.charge01, this.cart.shot.yaw),
        true,
      );
      return;
    }

    const playable = this.isResting() && !this.holedOut;
    this.lastShotWasStrike = playable;
    if (!playable) return;

    this.launch(this.cart.shot.yaw, this.cart.shot.charge01, this.cart.shot.club);
  }

  /** Where the ball is riding when loaded -- the renderer draws it there instead of on the course. */
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

  /** Full reset back to the tee: new hole, stroke count and cart position included. */
  reset(): void {
    this.lastSafePosition = { ...this.terrain.teePosition };
    this.dropAtLastSafePosition();
    this.strokes = 0;
    this.holedOut = false;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
    this.lastShotWasStrike = false;

    const spawn = cartSpawnPosition(this.terrain);
    this.cart.position.x = spawn.x;
    this.cart.position.y = spawn.y;
    this.cart.position.z = spawn.z;
    this.cart.heading = 0;
    this.cart.turretOffset = 0;
    // Health, death and momentum all clear here: a new hole starts alive, at full HP, standing
    // still. Ammo deliberately survives -- it is a round-spanning resource, HP is not. `stats`
    // survives too, being round-level rather than per-hole (sim/stats.ts).
    this.cart.revive();
    this.cartFallSpeed = 0;
    for (const target of this.targets) target.reset();
    this.cartBody.setTranslation(spawn, true);
    this.syncCurrentCart();
    this.previousCart = this.currentCart;
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
   * Snapshots the cart's own position rather than the rigid body's: a kinematic body only moves
   * when `world.step()` consumes the queued translation, so reading the body here would render
   * the cart one tick behind everything else.
   */
  private syncCurrentCart(): void {
    const p = this.cart.position;
    this.currentCart = {
      position: { x: p.x, y: p.y, z: p.z },
      heading: this.cart.heading,
      turretYaw: this.cart.turretYaw,
    };
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

function restCartTransform(terrain: Terrain): CartTransform {
  return { position: cartSpawnPosition(terrain), heading: 0, turretYaw: 0 };
}
