/**
 * Knockable course furniture, the rule half: which props a passing cart bowls over, and how each
 * one tumbles. No three.js, so it is node-tested; `knockables.ts` draws the result.
 *
 * Decoration only. These props own no collider and the sim never sees them, so a cart drives
 * through one exactly as it did before -- the prop just goes flying instead of ghosting. That is
 * what keeps this render-only (`AGENTS.md`: if removing it would change a sim result it is
 * playable, and removing these changes nothing).
 *
 * A knocked prop tips about a horizontal axis at right angles to the cart's travel, slides a
 * little along it, and comes to rest lying on its side with a small bounce. It stays down for the
 * rest of the match.
 */

/** A cart within this of a prop's base, in metres, can knock it. */
export const KNOCK_RADIUS_M = 1.6;
/** And must be going at least this fast, m/s. A crawl nudges past without toppling anything. */
export const KNOCK_MIN_SPEED = 4;
/** Lying down: a quarter turn. */
const REST_TILT = Math.PI / 2;
const GRAVITY_TIP = 14;
const BOUNCE = 0.3;
const SLIDE_DRAG = 3;

export class KnockState {
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  /** Radians tipped over, 0 standing to `REST_TILT` lying. */
  readonly tilt: Float32Array;
  /** The world direction it falls toward, as a unit (x, z). */
  readonly fallX: Float32Array;
  readonly fallZ: Float32Array;
  /** Slide offset from its home position, metres. */
  readonly slideX: Float32Array;
  readonly slideZ: Float32Array;
  private readonly tiltSpeed: Float32Array;
  private readonly slideVX: Float32Array;
  private readonly slideVZ: Float32Array;
  private readonly knocked: Uint8Array;
  private readonly resting: Uint8Array;

  constructor(placements: readonly { x: number; z: number; yaw: number }[]) {
    const n = placements.length;
    this.count = n;
    this.x = Float32Array.from(placements, (p) => p.x);
    this.z = Float32Array.from(placements, (p) => p.z);
    this.yaw = Float32Array.from(placements, (p) => p.yaw);
    this.tilt = new Float32Array(n);
    this.fallX = new Float32Array(n);
    this.fallZ = new Float32Array(n);
    this.slideX = new Float32Array(n);
    this.slideZ = new Float32Array(n);
    this.tiltSpeed = new Float32Array(n);
    this.slideVX = new Float32Array(n);
    this.slideVZ = new Float32Array(n);
    this.knocked = new Uint8Array(n);
    this.resting = new Uint8Array(n);
  }

  isKnocked(i: number): boolean {
    return this.knocked[i] === 1;
  }

  /**
   * A cart at (x, z) moving at (vx, vz). Knocks every standing prop it is close and fast enough
   * to, calling `onKnock` for each so the caller can puff dust and clatter. Returns how many fell.
   */
  pass(x: number, z: number, vx: number, vz: number, onKnock?: (i: number) => void): number {
    const speed = Math.hypot(vx, vz);
    if (speed < KNOCK_MIN_SPEED) return 0;
    let fell = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.knocked[i] === 1) continue;
      if (Math.hypot(this.x[i]! - x, this.z[i]! - z) > KNOCK_RADIUS_M) continue;
      this.knocked[i] = 1;
      this.fallX[i] = vx / speed;
      this.fallZ[i] = vz / speed;
      // Faster carts throw harder: a kick to the tip and a slide along the hit.
      this.tiltSpeed[i] = 2 + speed * 0.35;
      this.slideVX[i] = vx * 0.45;
      this.slideVZ[i] = vz * 0.45;
      fell++;
      onKnock?.(i);
    }
    return fell;
  }

  /** Advances every falling prop. Returns true if anything moved, so the caller can skip uploads. */
  update(dt: number): boolean {
    let moved = false;
    const slideDecay = Math.exp(-SLIDE_DRAG * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.knocked[i] === 0 || this.resting[i] === 1) continue;
      moved = true;
      // Tipping accelerates the further over it is, like a toppling post.
      this.tiltSpeed[i] = this.tiltSpeed[i]! + GRAVITY_TIP * Math.sin(Math.max(0.15, this.tilt[i]!)) * dt;
      let tilt = this.tilt[i]! + this.tiltSpeed[i]! * dt;
      if (tilt >= REST_TILT) {
        tilt = REST_TILT;
        this.tiltSpeed[i] = -this.tiltSpeed[i]! * BOUNCE;
        if (Math.abs(this.tiltSpeed[i]!) < 0.6) this.tiltSpeed[i] = 0;
      }
      this.tilt[i] = tilt;
      this.slideVX[i] = this.slideVX[i]! * slideDecay;
      this.slideVZ[i] = this.slideVZ[i]! * slideDecay;
      this.slideX[i] = this.slideX[i]! + this.slideVX[i]! * dt;
      this.slideZ[i] = this.slideZ[i]! + this.slideVZ[i]! * dt;
      const still = this.tiltSpeed[i] === 0 && Math.hypot(this.slideVX[i]!, this.slideVZ[i]!) < 0.05;
      if (still && tilt === REST_TILT) this.resting[i] = 1;
    }
    return moved;
  }
}
