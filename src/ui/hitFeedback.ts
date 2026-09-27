import { SCORE_PER_DAMAGE, SCORE_PER_KILL } from "../sim/scoring";
import type { MarkerKind } from "./hitMarkers";

/**
 * The player's hit feedback, as numbers the DOM layer draws: which way damage came from, how
 * strong the low-health vignette is, and what a hit marker says. DOM-free, so it is tested in the
 * node environment; `MatchScreen` owns the elements.
 */

/**
 * Where on screen a hit from `(fromX, fromZ)` came from, for a player at `(toX, toZ)` whose view
 * looks along `viewYaw`: radians clockwise from straight up, in (-PI, PI].
 *
 * The view is the chase camera's, which sits behind the turret, so `viewYaw` is the turret's yaw.
 * Yaw 0 looks down +x (AGENTS.md), and with +y up the camera's right-hand side is then +z.
 */
export function damageScreenAngle(fromX: number, fromZ: number, toX: number, toZ: number, viewYaw: number): number {
  const dx = fromX - toX;
  const dz = fromZ - toZ;
  const c = Math.cos(viewYaw);
  const s = Math.sin(viewYaw);
  const ahead = dx * c + dz * s;
  const right = -dx * s + dz * c;
  return Math.atan2(right, ahead);
}

/** How long a damage-direction flash takes to fade out. */
export const DAMAGE_INDICATOR_S = 1;
/** Hits closer together in angle than this refresh one flash rather than drawing two. */
const SAME_DIRECTION_RAD = 0.35;
/** At most this many flashes at once; the oldest goes first. */
const MAX_INDICATORS = 4;

export interface DamageIndicator {
  angle: number;
  age: number;
  /** 1 when fresh, falling to 0 as it fades. */
  opacity: number;
}

export class DamageIndicators {
  readonly active: DamageIndicator[] = [];

  add(angle: number): void {
    for (const ind of this.active) {
      const gap = Math.abs(Math.atan2(Math.sin(angle - ind.angle), Math.cos(angle - ind.angle)));
      if (gap < SAME_DIRECTION_RAD) {
        ind.angle = angle;
        ind.age = 0;
        ind.opacity = 1;
        return;
      }
    }
    if (this.active.length >= MAX_INDICATORS) this.active.shift();
    this.active.push({ angle, age: 0, opacity: 1 });
  }

  update(dt: number): void {
    for (const ind of this.active) {
      ind.age += dt;
      ind.opacity = Math.max(0, 1 - ind.age / DAMAGE_INDICATOR_S);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i]!.age >= DAMAGE_INDICATOR_S) this.active.splice(i, 1);
    }
  }

  clear(): void {
    this.active.length = 0;
  }
}

/** Health fraction at and above which the vignette is off. */
const LOW_HP_START = 0.5;

/**
 * 0..1 strength of the low-health vignette: off at half health and above, growing as health
 * falls. Off at 0 HP too, because a dead cart has the death banner and the respawn countdown.
 */
export function lowHpIntensity(hp: number, max: number): number {
  if (hp <= 0 || max <= 0) return 0;
  const fraction = hp / max;
  return Math.min(1, Math.max(0, 1 - fraction / LOW_HP_START));
}

/** The text over a player's hit or kill: what it earned. */
export function markerLabel(kind: MarkerKind, damage: number): string {
  return kind === "kill" ? `ENEMY DOWN +${SCORE_PER_KILL}` : `+${damage * SCORE_PER_DAMAGE}`;
}
