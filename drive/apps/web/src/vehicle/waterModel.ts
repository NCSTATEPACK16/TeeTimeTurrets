import type { CartTuning } from './cartTuning';

/** Water the cart is in this step. Depth is the mean over the four wheel positions. */
export interface WaterState {
  /** Water level minus ground height, m; 0 when dry. */
  depth: number;
  /** Water surface height, or null when dry. */
  level: number | null;
  /** How far the chassis bottom sits below the water surface, m. */
  submerged: number;
  /** Deep enough that the motor has stalled. */
  stalled: boolean;
  /** Buoyancy is carrying some of the cart's weight. */
  buoyant: boolean;
}

export const DRY: WaterState = Object.freeze({ depth: 0, level: null, submerged: 0, stalled: false, buoyant: false });

type WaterTuning = CartTuning['water'];

/** Motor force multiplier: fades linearly to 0 at the stall depth. */
export function motorFactor(depth: number, w: WaterTuning): number {
  return Math.min(Math.max(1 - depth / w.stallDepth, 0), 1);
}

/** Steering lock multiplier: eases toward w.steer as the water deepens to the stall depth. */
export function steerFactor(depth: number, w: WaterTuning): number {
  const k = Math.min(Math.max(depth / w.stallDepth, 0), 1);
  return 1 + (w.steer - 1) * k;
}

/** Horizontal drag force (N) opposing velocity (vx, vz): drag × depth × |v| × v. */
export function waterDrag(vx: number, vz: number, depth: number, w: WaterTuning): { x: number; z: number } {
  const speed = Math.hypot(vx, vz);
  const k = -w.drag * depth * speed;
  return { x: k * vx, z: k * vz };
}

/**
 * Upward buoyancy force (N): zero until the chassis bottom is floatStart under, then rising
 * linearly to the cart's weight over floatSpan, with heave damping on vertical velocity vy.
 */
export function buoyancy(submerged: number, vy: number, weight: number, w: WaterTuning): number {
  const over = submerged - w.floatStart;
  if (over <= 0) return 0;
  const lift = Math.min(over / w.floatSpan, 2) * weight;
  return Math.max(lift - w.heave * vy, 0);
}
