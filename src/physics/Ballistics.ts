/**
 * Pure math, zero engine dependencies (no THREE, no Rapier, no DOM). Every function is a
 * plain in/out transform so it can be unit-tested standalone and reused identically on
 * a future authoritative server. Anything touching randomness takes an injected `random`
 * function rather than calling Math.random() itself -- authoritative sim code must use a
 * seeded RNG (see docs/ARCHITECTURE.md, "Determinism").
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export enum ClubType {
  Putter = "putter",
  Iron = "iron",
  Driver = "driver",
}

export interface ClubStats {
  /** Launch angle above horizontal, degrees. */
  loftDeg: number;
  /** Speed (m/s) at 0% charge. */
  minSpeed: number;
  /** Speed (m/s) at 100% charge. */
  maxSpeed: number;
  /** Seconds of holding the swing button to reach 100% charge. */
  chargeSeconds: number;
  /** Seconds before this club can fire again after a shot. */
  reloadSeconds: number;
  /** Aim-cone half-angle (degrees) applied as random spread on release. */
  spreadDeg: number;
}

/**
 * Fast/short/quick vs. slow/long/powerful, per design direction: putter trades power for
 * accuracy and reload speed, driver is the opposite extreme, iron is the midpoint.
 * Starting values for playtesting, not measured constants -- tune by feel.
 */
export const CLUB_STATS: Record<ClubType, ClubStats> = {
  [ClubType.Putter]: { loftDeg: 3, minSpeed: 2, maxSpeed: 9, chargeSeconds: 0.5, reloadSeconds: 0.4, spreadDeg: 1 },
  [ClubType.Iron]: { loftDeg: 22, minSpeed: 8, maxSpeed: 24, chargeSeconds: 0.9, reloadSeconds: 1.1, spreadDeg: 3 },
  [ClubType.Driver]: { loftDeg: 13, minSpeed: 14, maxSpeed: 40, chargeSeconds: 1.4, reloadSeconds: 2.2, spreadDeg: 5 },
};

/**
 * Per-surface tuning moved to `src/sim/surfaces.ts` and is now live rather than aspirational.
 * It is keyed on `rolling` (coefficient of rolling resistance) and `bounceScale` instead of
 * restitution/friction, because there is one heightfield collider for the whole course --
 * a material that varies by position cannot be expressed as collider properties and has to
 * be applied per tick in `Sim.step()`. There is exactly one surface table; do not add
 * another here.
 */

/**
 * charge = clamp01(holdDurationSeconds / stats.chargeSeconds). Speed lerps min->max linearly
 * with charge; this is the "feel" curve from the Phase 0 spike, kept flat rather than eased
 * because a driver holding to full charge for 1.4s already reads as deliberate.
 */
export function chargeFraction(holdDurationSeconds: number, club: ClubType): number {
  const stats = CLUB_STATS[club];
  return clamp01(holdDurationSeconds / stats.chargeSeconds);
}

/**
 * yawRadians: 0 aims down world +X (matches src/sim/terrain.ts / src/sim/world.ts convention).
 * Returns a launch velocity vector, before any aim-spread is applied.
 */
export function computeLaunchVelocity(club: ClubType, charge01: number, yawRadians: number): Vec3 {
  const stats = CLUB_STATS[club];
  const speed = lerp(stats.minSpeed, stats.maxSpeed, clamp01(charge01));
  const loft = degToRad(stats.loftDeg);
  const horizontal = Math.cos(loft) * speed;
  const vertical = Math.sin(loft) * speed;
  return {
    x: Math.cos(yawRadians) * horizontal,
    y: vertical,
    z: Math.sin(yawRadians) * horizontal,
  };
}

/**
 * Randomized aim error within the club's accuracy cone, applied to yaw only (horizontal
 * spread reads more clearly than vertical spread for a top-down/chase camera). `random`
 * must be a seeded PRNG in any authoritative context -- see module doc comment.
 */
export function applyAimSpread(yawRadians: number, club: ClubType, random: () => number): number {
  const stats = CLUB_STATS[club];
  const spreadRadians = degToRad(stats.spreadDeg);
  const errorFraction = random() * 2 - 1; // -1..1
  return yawRadians + spreadRadians * errorFraction;
}

/**
 * Quadratic aerodynamic drag: F = -0.5 * rho * Cd * A * |v| * v, opposing velocity.
 * This is the physically correct model; the Phase 0 spike instead uses Rapier's cheaper
 * linear damping (F = -k * v) on the ball body, which is a reasonable arcade approximation
 * but under-decelerates fast shots and over-decelerates slow rolls relative to real drag.
 * This function exists for Phase 2+ if per-tick force-based drag turns out to feel better;
 * wiring it changes already-tuned Phase 0 feel, so it is not called anywhere yet.
 */
export interface DragParams {
  airDensity: number; // kg/m^3, ~1.2 at sea level
  dragCoefficient: number; // dimensionless, ~0.2-0.3 for a dimpled golf ball
  crossSectionAreaM2: number; // pi * r^2
}

export function computeDragForce(velocity: Vec3, params: DragParams): Vec3 {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speed < 1e-6) return { x: 0, y: 0, z: 0 };
  const magnitude = 0.5 * params.airDensity * params.dragCoefficient * params.crossSectionAreaM2 * speed;
  return {
    x: -magnitude * velocity.x,
    y: -magnitude * velocity.y,
    z: -magnitude * velocity.z,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
