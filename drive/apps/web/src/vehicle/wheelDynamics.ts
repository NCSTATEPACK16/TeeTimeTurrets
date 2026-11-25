import type { MaterialName, WheelName } from '@gcs/level-schema';
import type { Vec3 } from './VehicleModel';

/** Per-wheel motion at the contact patch, for skids, spray, dust and tire audio. */
export interface WheelDynamics {
  name: WheelName;
  inContact: boolean;
  material: MaterialName;
  contactPoint: Vec3;
  /** Ground speed of the contact patch, m/s. */
  speed: number;
  /** Contact-patch velocity along the wheel's rolling direction, m/s. */
  forwardSpeed: number;
  /** Contact-patch velocity across the wheel (sideways slide), m/s, unsigned. */
  sideSlip: number;
  /** Brake held hard on this wheel (handbrake on the rears, or a full brake pedal). */
  braking: boolean;
  /** Water depth at the wheel, m. */
  waterDepth: number;
}

/**
 * Velocity of a world point on the body: linvel + angvel × (p − com). Rapier has no slip
 * ratio, so slip comes from this projected on the wheel's forward and axle directions.
 */
export function pointVelocity(linvel: Vec3, angvel: Vec3, com: Vec3, p: Vec3): Vec3 {
  const rx = p.x - com.x;
  const ry = p.y - com.y;
  const rz = p.z - com.z;
  return {
    x: linvel.x + angvel.y * rz - angvel.z * ry,
    y: linvel.y + angvel.z * rx - angvel.x * rz,
    z: linvel.z + angvel.x * ry - angvel.y * rx,
  };
}

/** Wheel rolling direction in the chassis frame for a steering angle (positive = left). */
export function wheelForwardLocal(steering: number): Vec3 {
  return { x: -Math.sin(steering), y: 0, z: -Math.cos(steering) };
}

/** Wheel axle direction in the chassis frame for a steering angle (positive = left). */
export function wheelAxleLocal(steering: number): Vec3 {
  return { x: Math.cos(steering), y: 0, z: -Math.sin(steering) };
}
