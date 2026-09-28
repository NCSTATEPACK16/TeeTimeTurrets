/**
 * Camera shake as "trauma" (a 0..1 value that events add to and time bleeds off), and the speed
 * FOV kick. Pure numbers; `RenderScene.frameChase` applies them on top of the smoothed chase pose,
 * so a shake never feeds back into where the camera is heading.
 *
 * Shake is trauma squared: a light knock barely moves the view and a big hit throws it. The
 * motion is a sum of incommensurate sines rather than random numbers, so it is smooth frame to
 * frame and needs no RNG.
 */

export const TRAUMA_DECAY_PER_S = 1.6;
/** Largest sideways or vertical throw at full trauma, metres. */
export const MAX_SHAKE_M = 0.35;
/** Largest roll at full trauma, radians. */
const MAX_ROLL_RAD = 0.05;

export class CameraTrauma {
  value = 0;
  private time = 0;

  add(amount: number): void {
    this.value = Math.min(1, this.value + amount);
  }

  update(dt: number): void {
    this.time += dt;
    this.value = Math.max(0, this.value - TRAUMA_DECAY_PER_S * dt);
  }

  get shake(): number {
    return this.value * this.value;
  }

  /** This frame's offset in the camera's own right/up axes, and its roll. */
  offset(out: { x: number; y: number; roll: number }): void {
    const k = this.shake;
    if (k === 0) {
      out.x = 0;
      out.y = 0;
      out.roll = 0;
      return;
    }
    const t = this.time;
    out.x = MAX_SHAKE_M * k * wobble(t * 23.1, t * 37.7);
    out.y = MAX_SHAKE_M * k * wobble(t * 29.3 + 1.7, t * 41.9 + 0.4);
    out.roll = MAX_ROLL_RAD * k * wobble(t * 17.9 + 3.1, t * 31.3 + 2.2);
  }

  clear(): void {
    this.value = 0;
  }
}

/** Two sines at unrelated rates, averaged: stays in [-1, 1] and never settles into a pattern. */
function wobble(a: number, b: number): number {
  return (Math.sin(a) + Math.sin(b)) / 2;
}

export const BASE_FOV_DEG = 60;
export const MAX_FOV_KICK_DEG = 9;

/** Field of view for a forward speed given as a fraction of top speed. */
export function fovForSpeed(speed01: number): number {
  const s = Math.min(1, Math.max(0, speed01));
  return BASE_FOV_DEG + MAX_FOV_KICK_DEG * s * s;
}
