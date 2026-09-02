import { CLUB_STATS, ClubType } from "../../physics/Ballistics";
import type { Vec3 } from "../../physics/Ballistics";
import { createHealth } from "../health";
import type { Health } from "../health";
import type { SurfaceTuning } from "../surfaces";

/**
 * The golf cart as tank chassis: chassis heading, an independently-aimed turret, an equipped
 * club with its own reload, and recoil that shoves the cart around.
 *
 * DOM-free and Rapier-free by design. This class turns intent into a *desired* translation for
 * this tick; moving a body through terrain (and everything vertical -- gravity, slopes,
 * step-up) is the KinematicCharacterController's job in world.ts. Two reasons for the split:
 * a KCC needs a whole physics world, which would make every rule below untestable; and Phase 5
 * replays intents on the server, which wants exactly this function and none of the rendering.
 *
 * Allocation-free after construction, per the AGENTS.md hot-loop rule: `recoil`,
 * `desiredTranslation` and `shot` are scratch objects mutated in place, never rebuilt.
 */

export interface Vec2XZ {
  x: number;
  z: number;
}

/**
 * Normalised intent for one tick, deliberately written against image 14's touch control
 * inventory rather than against a keyboard -- `throttle`/`steer` are axes, not key states, so a
 * thumbstick, a gamepad and a scripted test array are all first-class sources. `aimDelta` is a
 * delta rather than an absolute yaw for the same reason: a mouse reports movement, a stick
 * reports rate, and neither knows an absolute heading.
 */
export interface CartIntent {
  /** Forward/reverse, -1..1. */
  throttle: number;
  /** Left/right, -1..1. */
  steer: number;
  brake: boolean;
  /** Turret yaw change this tick, radians. */
  aimDelta: number;
  /** True while the swing button is held; the release edge is what fires. */
  fire: boolean;
}

export enum TireType {
  Street = "street",
  Knobby = "knobby",
  Turf = "turf",
}

export interface TireTuning {
  /** Multiplier on top speed on every surface. */
  readonly topSpeedScale: number;
  /**
   * How much of a surface's `cartSpeedScale` penalty this tire actually suffers.
   * 0 would be immune to sand, 1 suffers it in full, above 1 suffers worse than stock.
   */
  readonly offRoadPenalty: number;
  /** Multiplier on steering authority and acceleration. */
  readonly grip: number;
}

/**
 * A trade, not a ladder -- this is what makes tire type a purchasable *stat* rather than a
 * skin (roadmap Phase 2 / Phase 3.5 economy). Turf is the fastest, grippiest fairway tire and
 * the worst thing to own in a bunker; knobby gives up top speed to barely notice rough and
 * sand; street sits between them and is the default.
 */
export const TIRE_TUNING: Readonly<Record<TireType, TireTuning>> = {
  [TireType.Street]: { topSpeedScale: 1.0, offRoadPenalty: 1.0, grip: 1.0 },
  [TireType.Knobby]: { topSpeedScale: 0.88, offRoadPenalty: 0.4, grip: 0.95 },
  [TireType.Turf]: { topSpeedScale: 1.06, offRoadPenalty: 1.25, grip: 1.15 },
};

export const STARTING_AMMO = 30;
export const BUCKET_REFILL_AMMO = 30;
export const MAX_AMMO = 100;

/**
 * Placeholder-but-real starting values, the same status POOL_SIZE had in the ammo spec: tunable
 * by feel once played. At 100 HP the damage table in `sim/combat.ts` makes a full-charge driver
 * hit worth 60, so two clean hits kill and a putter tap does not.
 */
export const STARTING_HP = 100;
/**
 * Death is a stroke penalty plus a wait, not a dead end -- long enough to be a real cost, short
 * enough that a hole is never abandoned over it.
 */
export const RESPAWN_DELAY_S = 3;

/**
 * Physics capsule, not the visual shape. A rounded body slides off heightfield triangle seams
 * that a box catches on, and the KCC resolves contacts far better for it; the cart *looks* boxy
 * regardless. `groundOffset` is the drop from the capsule centre (the cart's authoritative
 * position) to the ground it rests on.
 */
export const CART_COLLIDER = {
  radius: 0.6,
  halfHeight: 0.35,
  get groundOffset(): number {
    return this.radius + this.halfHeight;
  },
} as const;

/**
 * The turret, from concept image 03: it sits on the cart's *roof*, and its barrel is literally a
 * golf club -- a shaft with the club head as the muzzle. The ball rides up there and is fired out
 * of the club head, which is why these numbers live in the sim rather than only in the renderer:
 * `computeMuzzle` needs them to know where a shot originates, and a second copy in `GolfClub.ts`
 * would be exactly the duplicated-source-of-truth mistake AGENTS.md warns about for club stats.
 *
 * Heights are measured from the ground the cart rests on, not from the capsule centre.
 */
export const TURRET_GEOMETRY = {
  /** Roof height -- where the turret ring is bolted. */
  pivotHeight: 2.05,
  /** Shaft length from the turret pivot out to the club head. */
  barrelLength: 1.75,
} as const;

/** Starting values for playtesting, not measured constants -- tune by feel. */
export const CART_TUNING = {
  /** Forward top speed on a surface with no penalty, m/s (~31 mph: arcade, not a real cart). */
  topSpeed: 14,
  /** Reverse is deliberately slow enough that turning around beats backing up. */
  reverseTopSpeed: 5,
  accel: 9,
  brakeDecel: 18,
  coastDecel: 3.5,
  /** Radians per second of chassis yaw at full grip and full steering authority. */
  steerRate: 1.9,
  /** Speed at which steering reaches full authority. */
  steerFullSpeed: 6,
  /** Steering authority floor, so a stopped cart can still pivot instead of locking up. */
  pivotAuthority: 0.25,
  /** Recoil speed per m/s of launch speed. Driver at full charge kicks ~6 m/s. */
  recoilCoefficient: 0.15,
  /** Exponential decay rate of the recoil velocity, per second (~0.3 s half-life). */
  recoilDecay: 2.2,
  /** Lowest surface multiplier a tire choice can drag the cart down to. */
  minSurfaceScale: 0.05,
} as const;

export interface CartOptions {
  tire?: TireType;
  club?: ClubType;
  position?: Vec3;
  heading?: number;
  /** Turret angle *relative to the chassis*. 0 aims straight over the bonnet. */
  turretOffset?: number;
}

/**
 * A fired shot, surfaced as a flag on a reused object rather than a returned value or an
 * emitted event -- returning an object would allocate every tick in the fixed loop. The caller
 * (`Sim`) drains it by reading the fields and setting `fired = false`.
 */
export interface CartShot {
  fired: boolean;
  hasBall: boolean;
  club: ClubType;
  charge01: number;
  yaw: number;
}

export class Cart {
  /** World position. Owned here, but written by the character controller after it resolves. */
  readonly position: Vec3;
  /** Chassis yaw, radians. 0 points down world +X, matching terrain.ts and Ballistics.ts. */
  heading: number;
  /**
   * Turret yaw *relative to the chassis*, radians. 0 aims straight over the bonnet.
   *
   * Relative rather than absolute so that aiming is optional: a player who never touches the aim
   * control fires exactly where the cart is pointing, and one who does aim keeps that angle
   * through every turn instead of re-aiming after each one. Read `turretYaw` for world space.
   */
  turretOffset: number;
  /** Signed speed along `heading`, m/s. Negative is reverse. */
  speed: number;
  tire: TireType;
  /** Recoil velocity in world XZ, decaying every tick. Added to the desired translation. */
  readonly recoil: Vec2XZ;
  /**
   * Velocity in world XZ from being shunted by another cart, decaying exactly like `recoil`.
   *
   * A shove has to be a velocity term rather than an impulse because the cart is a kinematic
   * character controller and a KCC receives no impulses -- docs/DECISIONS.md's physics-ownership
   * table calls out "same for being shunted by another cart" by name. Kept separate from
   * `recoil` so the two read independently in a HUD or a replay, not because they behave
   * differently.
   */
  readonly shuntVelocity: Vec2XZ;
  /** HP. Damage is applied by sim/combat.ts; the cart only owns the number. */
  readonly health: Health;
  /** True while awaiting respawn. `world.ts` freezes intent and position for the duration. */
  dead: boolean;
  /** Seconds until respawn. Meaningful only while `dead`. */
  respawnTimer: number;
  /** Where the cart wants to move this tick. The controller decides where it actually goes. */
  readonly desiredTranslation: Vec3;
  readonly shot: CartShot;
  ammo: number;

  private club: ClubType;
  private reload = 0;
  private chargeHeld = 0;
  private wasFiring = false;

  constructor(options: CartOptions = {}) {
    const start = options.position ?? { x: 0, y: 0, z: 0 };
    this.position = { x: start.x, y: start.y, z: start.z };
    this.heading = options.heading ?? 0;
    this.turretOffset = options.turretOffset ?? 0;
    this.speed = 0;
    this.tire = options.tire ?? TireType.Street;
    this.club = options.club ?? ClubType.Driver;
    this.recoil = { x: 0, z: 0 };
    this.shuntVelocity = { x: 0, z: 0 };
    this.desiredTranslation = { x: 0, y: 0, z: 0 };
    this.ammo = STARTING_AMMO;
    this.health = createHealth(STARTING_HP);
    this.dead = false;
    this.respawnTimer = 0;
    this.shot = { fired: false, hasBall: false, club: this.club, charge01: 0, yaw: 0 };
  }

  get equippedClub(): ClubType {
    return this.club;
  }

  /** Where the turret points in world space. Derived, so it tracks the chassis for free. */
  get turretYaw(): number {
    return this.heading + this.turretOffset;
  }

  get reloadRemaining(): number {
    return this.reload;
  }

  get canFire(): boolean {
    return this.reload <= 0;
  }

  /** Swing charge, 0..1, for the HUD power meter. */
  get charge(): number {
    return this.chargeHeld;
  }

  /**
   * Swapping clubs deliberately does NOT clear the reload: otherwise the fastest fire rate in
   * the game is "swap away and back", and every `reloadSeconds` value becomes decorative. The
   * charge does reset, because charge time is a per-club stat.
   */
  selectClub(club: ClubType): void {
    if (club === this.club) return;
    this.club = club;
    this.chargeHeld = 0;
  }

  /**
   * Back to full HP, alive, and standing still. Called on respawn and on a new hole -- health is
   * a per-encounter stat that a fresh start resets, unlike ammo, which is a round-spanning
   * resource and is deliberately left alone here.
   *
   * Momentum is cleared too: arriving at the tee still carrying the speed and the shove that
   * killed you would fire you straight back off it.
   */
  revive(): void {
    this.health.hp = this.health.max;
    this.dead = false;
    this.respawnTimer = 0;
    this.speed = 0;
    this.recoil.x = 0;
    this.recoil.z = 0;
    this.shuntVelocity.x = 0;
    this.shuntVelocity.z = 0;
  }

  /** Clamps to MAX_AMMO. Used by bucket refills and landed-ball pickups alike. */
  addAmmo(n: number): void {
    this.ammo = Math.min(MAX_AMMO, this.ammo + n);
  }

  /**
   * Fire at `charge01` (0..1). Returns false and does nothing if still reloading, so the caller
   * can distinguish "shot taken" from "click ignored" without reading the timer itself.
   *
   * Recoil opposes the shot -- a forward-facing driver shoves the cart backwards. Image 04
   * appears to show the opposite; UI-SPEC.md §7 reads that frame as a rear-end squat under
   * recoil rather than a forward boost.
   */
  fire(charge01: number): boolean {
    if (!this.canFire) return false;

    const stats = CLUB_STATS[this.club];
    const charge = clamp01(charge01);
    const launchSpeed = stats.minSpeed + (stats.maxSpeed - stats.minSpeed) * charge;
    const kick = launchSpeed * CART_TUNING.recoilCoefficient;

    this.recoil.x -= Math.cos(this.turretYaw) * kick;
    this.recoil.z -= Math.sin(this.turretYaw) * kick;

    this.reload = stats.reloadSeconds;
    this.chargeHeld = 0;

    const hasBall = this.ammo > 0;
    if (hasBall) this.ammo -= 1;

    this.shot.fired = true;
    this.shot.hasBall = hasBall;
    this.shot.club = this.club;
    this.shot.charge01 = charge;
    this.shot.yaw = this.turretYaw;
    return true;
  }

  step(intent: CartIntent, dt: number, surface: SurfaceTuning): void {
    if (this.reload > 0) this.reload = Math.max(0, this.reload - dt);

    this.turretOffset += intent.aimDelta;

    this.stepSwing(intent, dt);
    this.stepDrive(intent, dt, surface);

    // Recoil decays exponentially rather than linearly: a linear ramp reads as the cart being
    // dragged to a stop, an exponential one as a shove that runs out. A shunt from another cart
    // is the same kind of shove and shares the rate.
    const decay = Math.exp(-CART_TUNING.recoilDecay * dt);
    this.recoil.x *= decay;
    this.recoil.z *= decay;
    this.shuntVelocity.x *= decay;
    this.shuntVelocity.z *= decay;

    const driftX = this.recoil.x + this.shuntVelocity.x;
    const driftZ = this.recoil.z + this.shuntVelocity.z;
    this.desiredTranslation.x = (Math.cos(this.heading) * this.speed + driftX) * dt;
    this.desiredTranslation.y = 0;
    this.desiredTranslation.z = (Math.sin(this.heading) * this.speed + driftZ) * dt;
  }

  /** Charge on hold, fire on the release edge. Charging is blocked while reloading. */
  private stepSwing(intent: CartIntent, dt: number): void {
    if (intent.fire) {
      if (this.canFire) {
        this.chargeHeld = clamp01(this.chargeHeld + dt / CLUB_STATS[this.club].chargeSeconds);
      }
    } else if (this.wasFiring && this.chargeHeld > 0) {
      this.fire(this.chargeHeld);
    }
    this.wasFiring = intent.fire;
  }

  private stepDrive(intent: CartIntent, dt: number, surface: SurfaceTuning): void {
    const tire = TIRE_TUNING[this.tire];

    // A tire does not change the surface, it changes how much of the surface's penalty reaches
    // the cart -- so the penalty is scaled, not the multiplier. On a surface with no penalty
    // (cartSpeedScale 1) every tire is equal here and only topSpeedScale separates them.
    const surfaceScale = Math.max(
      CART_TUNING.minSurfaceScale,
      1 - (1 - surface.cartSpeedScale) * tire.offRoadPenalty,
    );
    const scale = tire.topSpeedScale * surfaceScale;
    const maxForward = CART_TUNING.topSpeed * scale;
    const maxReverse = -CART_TUNING.reverseTopSpeed * scale;

    const throttle = clampSigned(intent.throttle);
    if (intent.brake) {
      this.speed = decayToward(this.speed, 0, CART_TUNING.brakeDecel * tire.grip * dt);
    } else if (throttle !== 0) {
      this.speed += throttle * CART_TUNING.accel * tire.grip * dt;
    } else {
      this.speed = decayToward(this.speed, 0, CART_TUNING.coastDecel * dt);
    }
    this.speed = Math.min(maxForward, Math.max(maxReverse, this.speed));

    // Steering authority rises with speed but never reaches zero, so a stopped cart can still
    // pivot -- a golf cart that cannot turn on the spot feels broken long before it feels
    // realistic. Reversing flips the steering the way a real vehicle does.
    const authority = Math.min(
      1,
      Math.max(CART_TUNING.pivotAuthority, Math.abs(this.speed) / CART_TUNING.steerFullSpeed),
    );
    const reversing = this.speed < -0.1 ? -1 : 1;
    this.heading += clampSigned(intent.steer) * CART_TUNING.steerRate * tire.grip * authority * reversing * dt;
  }
}

/**
 * World position of the club head at the end of the turret's barrel -- where a fired ball comes
 * from and where the carried ball rides.
 *
 * The barrel's elevation is the equipped club's own `loftDeg`, which is the whole trick that
 * makes the club-as-cannon read: the putter barrel lies almost flat, the iron cocks up steeply,
 * and the shot that leaves the muzzle matches the angle you can see. One number driving both the
 * silhouette and the ballistics means they cannot disagree.
 *
 * Writes into `out` rather than returning, because this runs inside the fixed tick.
 */
export function computeMuzzle(cart: Cart, out: Vec3): void {
  const loft = degToRad(CLUB_STATS[cart.equippedClub].loftDeg);
  const reach = Math.cos(loft) * TURRET_GEOMETRY.barrelLength;
  const rise = Math.sin(loft) * TURRET_GEOMETRY.barrelLength;
  const yaw = cart.turretYaw;

  out.x = cart.position.x + Math.cos(yaw) * reach;
  out.y = cart.position.y - CART_COLLIDER.groundOffset + TURRET_GEOMETRY.pivotHeight + rise;
  out.z = cart.position.z + Math.sin(yaw) * reach;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clampSigned(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

function decayToward(value: number, target: number, maxDelta: number): number {
  if (value > target) return Math.max(target, value - maxDelta);
  return Math.min(target, value + maxDelta);
}
