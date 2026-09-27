/**
 * The damage-direction flash: a red wedge at the screen's edge pointing at whoever just hit the
 * player. DOM-free here; `MatchScreen` writes it.
 */

/** Seconds a flash takes to fade out. */
export const DAMAGE_FLASH_SECONDS = 0.9;
/** Flashes shown at once. A fifth hit in under a second replaces the oldest. */
const MAX_FLASHES = 4;

/**
 * Where a shot came from, as a screen angle: radians clockwise from straight up. The chase camera
 * looks along `viewYaw` (the turret), and in this world a yaw of 0 looks down +X with +Z on the
 * screen's right, so a positive answer is a shot from the right.
 */
export function damageBearing(playerX: number, playerZ: number, viewYaw: number, fromX: number, fromZ: number): number {
  const bearing = Math.atan2(fromZ - playerZ, fromX - playerX);
  const relative = bearing - viewYaw;
  return Math.atan2(Math.sin(relative), Math.cos(relative));
}

export interface DamageFlash {
  bearing: number;
  /** 1 on the frame it lands, falling to 0. */
  alpha: number;
}

export class DamageFlashes {
  readonly active: DamageFlash[] = [];

  push(bearing: number): void {
    this.active.push({ bearing, alpha: 1 });
    if (this.active.length > MAX_FLASHES) this.active.shift();
  }

  update(dt: number): void {
    for (const flash of this.active) flash.alpha -= dt / DAMAGE_FLASH_SECONDS;
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i]!.alpha <= 0) this.active.splice(i, 1);
  }
}
