import type RAPIER from '@dimforge/rapier3d-compat';
import { MATERIAL_NAMES, WHEEL_NAMES, headingToYaw, type MaterialName, type Pose } from '@gcs/level-schema';
import type { HeightSampler } from '../level/heightSampler';
import type { SurfaceSampler } from '../level/surfaceSampler';
import type { WaterSampler } from '../level/waterSampler';
import type { Rapier } from '../physics/world';
import { cartTuning, type CartTuning } from './cartTuning';
import { RolloverAssist } from './rollover';
import { surfaces as surfaceTuning } from './surfaces';
import type { Quat, Vec3, VehicleInput, VehicleModel, WheelState } from './VehicleModel';
import { DRY, buoyancy, motorFactor, steerFactor, waterDrag, type WaterState } from './waterModel';
import { pointVelocity, wheelAxleLocal, wheelForwardLocal, type WheelDynamics } from './wheelDynamics';

const DEG = Math.PI / 180;
const DOWN = { x: 0, y: -1, z: 0 };
// With the axle along +X and suspension along -Y, positive engine force drives toward local -Z,
// and positive steering turns left (verified by test/vehicle/forward.test.ts).
const AXLE = { x: 1, y: 0, z: 0 };

/** Rotate v by unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One-step happenings the effects, camera and HUD react to. Cleared at the start of each update. */
export interface CartEvents {
  /** Downward speed at touchdown after airtime, m/s; null when no landing this step. */
  landing: number | null;
  /** The never-stuck nudge fired this step. */
  nudged: boolean;
}

/** The cart: a box chassis on Rapier's DynamicRayCastVehicleController, rear-wheel drive. */
export class RapierCart implements VehicleModel {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** Wheel mounts in the chassis frame, in WHEEL_NAMES order (FL, FR, RL, RR). */
  readonly mounts: readonly Vec3[];
  /** Righting assist on/off; tests switch it off to measure raw chassis roll. */
  assists = true;
  readonly events: CartEvents = { landing: null, nudged: false };
  private t: CartTuning;
  private steerAngle = 0;
  private readonly gravity: number;
  private readonly rollover = new RolloverAssist();
  private readonly braking = [false, false, false, false];
  private boostLeft = 1;
  private boosting = false;
  private water: WaterState = DRY;
  private afloatTime = 0;
  private airTime = 0;
  private stuckTime = 0;
  private time = 0;
  private lastNudge = -Infinity;
  private resetOffered = false;

  constructor(
    R: Rapier,
    world: RAPIER.World,
    private readonly heights: HeightSampler,
    private readonly surfaces: SurfaceSampler,
    tuning: CartTuning = cartTuning,
    private readonly waterSampler: WaterSampler | null = null,
  ) {
    this.t = tuning;
    const t = tuning;
    this.gravity = Math.abs(world.gravity.y);
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic().setAngularDamping(t.angularDamping).setCanSleep(false));
    const { halfWidth: hx, halfHeight: hy, halfLength: hz } = t.body;
    const m = t.mass;
    // Solid box inertia about its center; the low center of mass is the stability trick.
    const inertia = { x: (m / 3) * (hy * hy + hz * hz), y: (m / 3) * (hx * hx + hz * hz), z: (m / 3) * (hx * hx + hy * hy) };
    world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(m, { x: 0, y: t.centerOfMassY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.5),
      this.body,
    );

    const front = -t.wheelbase / 2;
    const rear = t.wheelbase / 2;
    this.mounts = [
      { x: -t.trackFront / 2, y: t.hardpointY, z: front },
      { x: t.trackFront / 2, y: t.hardpointY, z: front },
      { x: -t.trackRear / 2, y: t.hardpointY, z: rear },
      { x: t.trackRear / 2, y: t.hardpointY, z: rear },
    ];
    this.controller = world.createVehicleController(this.body);
    for (const mount of this.mounts) this.controller.addWheel(mount, DOWN, AXLE, t.suspension.restLength, t.wheelRadius);
    this.applyWheelTuning();
  }

  get tuning(): CartTuning {
    return this.t;
  }

  /**
   * Switch feel presets (mode change, tuning panel). Chassis geometry and mass are fixed at
   * construction, so a preset with different geometry is rejected.
   */
  setTuning(t: CartTuning): void {
    const a = this.t;
    const same =
      a.mass === t.mass &&
      a.wheelbase === t.wheelbase &&
      a.trackFront === t.trackFront &&
      a.trackRear === t.trackRear &&
      a.wheelRadius === t.wheelRadius &&
      a.hardpointY === t.hardpointY &&
      a.centerOfMassY === t.centerOfMassY &&
      a.body.halfWidth === t.body.halfWidth &&
      a.body.halfHeight === t.body.halfHeight &&
      a.body.halfLength === t.body.halfLength;
    if (!same) throw new Error('setTuning cannot change chassis geometry or mass');
    this.t = t;
    this.body.setAngularDamping(t.angularDamping);
    this.applyWheelTuning();
    this.rollover.reset();
    this.boostLeft = Math.min(this.boostLeft, 1);
  }

  private applyWheelTuning(): void {
    const t = this.t;
    const s = t.suspension;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionRestLength(i, s.restLength);
      this.controller.setWheelRadius(i, t.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, s.stiffness);
      this.controller.setWheelSuspensionCompression(i, s.compression);
      this.controller.setWheelSuspensionRelaxation(i, s.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, s.maxTravel);
      this.controller.setWheelMaxSuspensionForce(i, s.maxForce);
      this.controller.setWheelFrictionSlip(i, t.frictionSlip * (i >= 2 ? t.rearGrip : 1));
      this.controller.setWheelSideFrictionStiffness(i, t.sideFrictionStiffness);
    }
  }

  update(input: VehicleInput, dt: number): void {
    const t = this.t;
    const v = this.forwardSpeed();
    this.time += dt;
    this.events.landing = null;
    this.events.nudged = false;

    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) contacts++;
    const materials = this.wheelMaterials();
    this.water = this.sampleWater();
    const depth = this.water.depth;

    // Steering: rate-limited, with less lock at speed and in water.
    const speedFrac = Math.min(Math.abs(v) / t.drive.topSpeed, 1);
    const lock =
      (t.steer.maxAngleDeg + (t.steer.highSpeedAngleDeg - t.steer.maxAngleDeg) * speedFrac) * DEG * steerFactor(depth, t.water);
    const target = -clamp(input.steer, -1, 1) * lock; // input +1 = right; Rapier + = left
    const returning = Math.abs(target) < Math.abs(this.steerAngle) || target * this.steerAngle < 0;
    const rate = (returning ? t.steer.returnRateDegPerS : t.steer.rateDegPerS) * DEG * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    this.controller.setWheelSteering(0, this.steerAngle);
    this.controller.setWheelSteering(1, this.steerAngle);

    // Boost meter: drains while boosting, refills while released.
    const throttle = clamp(input.throttle, 0, 1);
    const pedalBrake = clamp(input.brake, 0, 1);
    this.boosting = t.boost.enabled && input.boost && throttle > 0 && !input.handbrake && this.boostLeft > 0;
    if (this.boosting) this.boostLeft = Math.max(this.boostLeft - dt / t.boost.duration, 0);
    else if (!input.boost) this.boostLeft = Math.min(this.boostLeft + dt / t.boost.recharge, 1);
    const topSpeed = this.boosting ? t.boost.topSpeed : t.drive.topSpeed;
    const power = this.boosting ? t.boost.power : t.drive.power;

    // Pedals: throttle drives; brake slows, then reverses once stopped; no input coasts or holds.
    // The handbrake cuts the motor and locks up the rears.
    let drive = 0;
    let brake = 0;
    let rearBrake = 0;
    if (input.handbrake) {
      rearBrake = t.handbrake.force;
      if (pedalBrake > 0) brake = t.brake.force * pedalBrake;
    } else if (throttle > 0) {
      if (v < -t.brake.reverseBelowSpeed) brake = t.brake.force * throttle;
      else drive = this.governedForce(v, topSpeed * throttle, power);
    } else if (pedalBrake > 0) {
      if (v > t.brake.reverseBelowSpeed) brake = t.brake.force * pedalBrake;
      else drive = -this.governedForce(-v, t.drive.reverseTopSpeed * pedalBrake, t.drive.power);
    } else {
      brake = Math.abs(v) < t.brake.holdSpeed ? t.brake.force : t.brake.coastForce;
    }
    drive *= motorFactor(depth, t.water);
    const hardPedal = pedalBrake > 0.9 && v > t.brake.reverseBelowSpeed;
    // Rapier applies engine force * dt; brake is an impulse cap per step, used only on wheels without engine force.
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      const wheelBrake = brake / 4 + (rear ? rearBrake / 2 : 0);
      this.controller.setWheelEngineForce(i, rear ? drive / 2 : 0);
      this.controller.setWheelBrake(i, drive === 0 ? wheelBrake * dt : 0);
      this.braking[i] = (rear && input.handbrake) || hardPedal;
      // Per-wheel grip from the surface under it, with the handbrake's rear grip drop.
      const grip = surfaceTuning[materials[i]!].grip * (rear ? t.rearGrip * (input.handbrake ? t.handbrake.rearGrip : 1) : 1);
      this.controller.setWheelFrictionSlip(i, t.frictionSlip * grip);
    }

    // Rolling resistance (per surface) and air drag, scaled by how many wheels touch the ground.
    let surfaceDrag = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) surfaceDrag += surfaceTuning[materials[i]!].rollingDrag;
    const rolling = t.resistance.rolling * t.mass * this.gravity * clamp(v / 0.5, -1, 1) * (surfaceDrag / 4);
    const air = t.resistance.airDrag * v * Math.abs(v);
    const j = -(rolling + air) * dt;
    const fwd = this.forward();
    this.body.applyImpulse({ x: fwd.x * j, y: fwd.y * j, z: fwd.z * j }, true);

    const lin = this.body.linvel();
    const ang = this.body.angvel();

    // Water: depth drag on horizontal motion, buoyancy once the chassis is well under.
    if (depth > 0) {
      const d = waterDrag(lin.x, lin.z, depth, t.water);
      const lift = buoyancy(this.water.submerged, lin.y, t.mass * this.gravity, t.water);
      this.body.applyImpulse({ x: d.x * dt, y: lift * dt, z: d.z * dt }, true);
    }
    this.afloatTime = this.water.stalled ? this.afloatTime + dt : 0;

    // Handbrake yaw damping keeps drifts catchable.
    if (input.handbrake && contacts > 0) this.body.applyTorqueImpulse({ x: 0, y: -t.handbrake.yawDamping * ang.y * dt, z: 0 }, true);

    // A little air steering.
    if (contacts === 0 && t.airSteerTorque > 0) {
      this.body.applyTorqueImpulse({ x: 0, y: -clamp(input.steer, -1, 1) * t.airSteerTorque * dt, z: 0 }, true);
    }

    // Righting assist.
    const up = rotate(this.body.rotation(), { x: 0, y: 1, z: 0 });
    const angle = t.rollover.measure === 'roll' ? this.fullRollDeg() : this.tiltDeg();
    if (this.rollover.update(angle, dt, t.rollover) && this.assists) {
      // Axis that turns the chassis up vector toward world up: up × Y.
      let ax = -up.z;
      let az = up.x;
      const len = Math.hypot(ax, az);
      if (len > 1e-6) {
        ax /= len;
        az /= len;
      } else {
        // Upside down exactly: roll about the forward axis.
        ax = fwd.x;
        az = fwd.z;
      }
      const tilt = Math.acos(clamp(up.y, -1, 1));
      const spin = ang.x * ax + ang.z * az;
      const tau = (t.rollover.torque * tilt - t.rollover.damping * spin) * dt;
      this.body.applyTorqueImpulse({ x: ax * tau, y: 0, z: az * tau }, true);
    }

    // Never stuck: throttle (or reverse) held but the cart won't move.
    const pushing = !input.handbrake && (throttle > 0.1 || pedalBrake > 0.1);
    if (pushing && Math.abs(v) < t.stuck.speed && !this.water.stalled) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime >= t.stuck.time) {
      const back = throttle > 0.1 ? -t.stuck.backImpulse : t.stuck.backImpulse;
      this.body.applyImpulse({ x: fwd.x * back, y: t.stuck.upImpulse, z: fwd.z * back }, true);
      if (this.time - this.lastNudge < t.stuck.offerResetWithin) this.resetOffered = true;
      this.lastNudge = this.time;
      this.stuckTime = 0;
      this.events.nudged = true;
    }

    const vyBefore = lin.y;
    this.controller.updateVehicle(dt);

    // Landing: touchdown after real airtime.
    let after = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) after++;
    if (after === 0) {
      this.airTime += dt;
    } else {
      if (this.airTime >= t.landingMinAir) this.events.landing = Math.max(-vyBefore, 0);
      this.airTime = 0;
    }
  }

  /** Motor force toward a target speed: force- then power-limited, faded out by the governor near the target. */
  private governedForce(speed: number, target: number, power: number): number {
    const d = this.t.drive;
    const available = Math.min(d.maxForce, power / Math.max(Math.abs(speed), 0.1));
    return available * clamp((target - speed) / d.governorBand, 0, 1);
  }

  private wheelMaterials(): MaterialName[] {
    const out: MaterialName[] = [];
    for (let i = 0; i < 4; i++) {
      const p = this.controller.wheelContactPoint(i) ?? this.controller.wheelHardPoint(i) ?? this.position();
      out.push(MATERIAL_NAMES[this.surfaces.materialIdAt(p.x, p.z)] ?? 'rough');
    }
    return out;
  }

  private sampleWater(): WaterState {
    if (!this.waterSampler) return DRY;
    const q = this.body.rotation();
    const pos = this.body.translation();
    let depth = 0;
    let level: number | null = null;
    for (const m of this.mounts) {
      const p = rotate(q, m);
      const hit = this.waterSampler.at(pos.x + p.x, pos.z + p.z);
      if (hit) {
        depth += hit.depth / 4;
        level = Math.max(level ?? -Infinity, hit.level);
      }
    }
    if (level === null) return DRY;
    const bottom = pos.y - this.t.body.halfHeight;
    const submerged = clamp(level - bottom, 0, 2 * this.t.body.halfHeight);
    return {
      depth,
      level,
      submerged,
      stalled: depth >= this.t.water.stallDepth,
      buoyant: submerged > this.t.water.floatStart,
    };
  }

  reset(pose: Pose): void {
    const t = this.t;
    const yaw = headingToYaw(pose.headingDeg);
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    // Highest ground under any wheel, so no wheel starts below the surface on a slope.
    let ground = -Infinity;
    for (const m of this.mounts) {
      const p = rotate(q, m);
      ground = Math.max(ground, this.heights.heightAt(pose.x + p.x, pose.z + p.z));
    }
    const y = ground + t.wheelRadius + t.suspension.restLength - t.hardpointY + t.spawnClearance;
    this.body.setTranslation({ x: pose.x, y, z: pose.z }, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.steerAngle = 0;
    this.rollover.reset();
    this.boostLeft = 1;
    this.boosting = false;
    this.water = DRY;
    this.afloatTime = 0;
    this.airTime = 0;
    this.stuckTime = 0;
    this.lastNudge = -Infinity;
    this.resetOffered = false;
    this.braking.fill(false);
  }

  /** Set the velocity along the cart's forward axis (tests and scripted launches). */
  setForwardSpeed(speed: number): void {
    const f = this.forward();
    this.body.setLinvel({ x: f.x * speed, y: f.y * speed, z: f.z * speed }, true);
  }

  position(): Vec3 {
    return this.body.translation();
  }

  quaternion(): Quat {
    return this.body.rotation();
  }

  /** Unit forward vector (local -Z) in world space. */
  forward(): Vec3 {
    return rotate(this.body.rotation(), { x: 0, y: 0, z: -1 });
  }

  forwardSpeed(): number {
    const v = this.body.linvel();
    const f = this.forward();
    return v.x * f.x + v.y * f.y + v.z * f.z;
  }

  /** Yaw rate about world up, deg/s (positive = turning left, counter-clockwise from above). */
  yawRateDeg(): number {
    return this.body.angvel().y / DEG;
  }

  rollDeg(): number {
    const right = rotate(this.body.rotation(), { x: 1, y: 0, z: 0 });
    return -Math.asin(clamp(right.y, -1, 1)) / DEG;
  }

  /** Roll about the forward axis over the full ±180° (rollDeg's asin reads 0° upside down). */
  fullRollDeg(): number {
    const q = this.body.rotation();
    const right = rotate(q, { x: 1, y: 0, z: 0 });
    const up = rotate(q, { x: 0, y: 1, z: 0 });
    return Math.atan2(-right.y, up.y) / DEG;
  }

  pitchDeg(): number {
    return Math.asin(clamp(this.forward().y, -1, 1)) / DEG;
  }

  /** Angle between the chassis up axis and world up, degrees. */
  tiltDeg(): number {
    const up = rotate(this.body.rotation(), { x: 0, y: 1, z: 0 });
    return Math.acos(clamp(up.y, -1, 1)) / DEG;
  }

  steeringAngle(): number {
    return this.steerAngle;
  }

  /** Boost meter, 0..1. */
  boostMeter(): number {
    return this.boostLeft;
  }

  isBoosting(): boolean {
    return this.boosting;
  }

  waterState(): WaterState {
    return this.water;
  }

  /** Seconds the cart has been in water deep enough to stall the motor. */
  afloatSeconds(): number {
    return this.afloatTime;
  }

  rightingAssistEngaged(): boolean {
    return this.rollover.engaged && this.assists;
  }

  /** True after two never-stuck nudges close together; the HUD offers a reset. Cleared by reset(). */
  resetSuggested(): boolean {
    return this.resetOffered;
  }

  wheels(): WheelState[] {
    const t = this.t;
    return WHEEL_NAMES.map((name, i) => {
      const inContact = this.controller.wheelIsInContact(i);
      let contactPoint: Vec3;
      const hit = inContact ? this.controller.wheelContactPoint(i) : null;
      if (hit) {
        contactPoint = { x: hit.x, y: hit.y, z: hit.z };
      } else {
        const hp = this.controller.wheelHardPoint(i) ?? this.position();
        contactPoint = { x: hp.x, y: hp.y - t.suspension.restLength - t.wheelRadius, z: hp.z };
      }
      const materialId = this.surfaces.materialIdAt(contactPoint.x, contactPoint.z);
      return {
        name,
        inContact,
        contactPoint,
        materialId,
        material: MATERIAL_NAMES[materialId] ?? 'rough',
        suspensionLength: this.controller.wheelSuspensionLength(i) ?? t.suspension.restLength,
        rotation: this.controller.wheelRotation(i) ?? 0,
        steering: this.controller.wheelSteering(i) ?? 0,
      };
    });
  }

  /** Contact-patch motion per wheel, for skids, spray, dust and tire audio. */
  dynamics(): WheelDynamics[] {
    const q = this.body.rotation();
    const lin = this.body.linvel();
    const ang = this.body.angvel();
    const com = this.body.worldCom();
    return this.wheels().map((w, i) => {
      const v = pointVelocity(lin, ang, com, w.contactPoint);
      const f = rotate(q, wheelForwardLocal(w.steering));
      const a = rotate(q, wheelAxleLocal(w.steering));
      return {
        name: w.name,
        inContact: w.inContact,
        material: w.material,
        contactPoint: w.contactPoint,
        speed: Math.hypot(v.x, v.z),
        forwardSpeed: v.x * f.x + v.y * f.y + v.z * f.z,
        sideSlip: Math.abs(v.x * a.x + v.y * a.y + v.z * a.z),
        braking: this.braking[i]!,
        waterDepth: this.waterSampler?.depthAt(w.contactPoint.x, w.contactPoint.z) ?? 0,
      };
    });
  }
}
