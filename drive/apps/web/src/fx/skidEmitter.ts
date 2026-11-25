import type { WheelDynamics } from '../vehicle/wheelDynamics';
import { skidEmit, skidTint } from './fxConfig';

export type SkidInput = Pick<WheelDynamics, 'inContact' | 'material' | 'speed' | 'forwardSpeed' | 'sideSlip' | 'braking'>;

/**
 * Whether a wheel lays a skid mark this step, and in what color. A pure function of wheel
 * state: on the ground, moving faster than minSpeed, and either sliding sideways past the
 * slip threshold or braking hard while still rolling fast. Water never marks.
 */
export function skidTintFor(w: SkidInput, cfg = skidEmit): string | null {
  if (!w.inContact) return null;
  const tint = skidTint[w.material];
  if (tint === null) return null;
  if (w.speed <= cfg.minSpeed) return null;
  const sliding = w.sideSlip > cfg.sideSlip;
  const locked = w.braking && Math.abs(w.forwardSpeed) > cfg.lockSpeed;
  return sliding || locked ? tint : null;
}

export function shouldSkid(w: SkidInput, cfg = skidEmit): boolean {
  return skidTintFor(w, cfg) !== null;
}
