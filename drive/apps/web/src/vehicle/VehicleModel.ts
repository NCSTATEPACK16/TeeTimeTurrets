import type { MaterialName, Pose, WheelName } from '@gcs/level-schema';

/** Driver intent for one physics step. */
export interface VehicleInput {
  /** 0..1 */
  throttle: number;
  /** 0..1; brakes while rolling forward, reverses once stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** Drift handbrake: cuts the motor, brakes the rear wheels and drops their grip. */
  handbrake: boolean;
  /** Hold to boost (presets with boost enabled only). */
  boost: boolean;
}

export const NO_INPUT: VehicleInput = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface WheelState {
  name: WheelName;
  inContact: boolean;
  /** Ground contact point when in contact, otherwise the wheel's lowest point at full extension. */
  contactPoint: Vec3;
  materialId: number;
  material: MaterialName;
  suspensionLength: number;
  /** Wheel spin angle, radians. */
  rotation: number;
  /** Steering angle, radians (positive = left). */
  steering: number;
}

/**
 * What the game needs from a vehicle. RapierCart implements it with Rapier's raycast
 * vehicle; the PRD keeps room for a custom arcade model behind the same interface.
 */
export interface VehicleModel {
  /** Apply input; call once per fixed step, before world.step(). */
  update(input: VehicleInput, dt: number): void;
  /** Place the cart at rest on the ground at a pose. */
  reset(pose: Pose): void;
  position(): Vec3;
  quaternion(): Quat;
  /** Signed speed along the cart's forward axis, m/s. */
  forwardSpeed(): number;
  /** Roll angle, degrees (positive = right side down). */
  rollDeg(): number;
  pitchDeg(): number;
  wheels(): WheelState[];
}
