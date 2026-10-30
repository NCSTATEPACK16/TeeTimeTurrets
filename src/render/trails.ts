import type { EffectsLayer } from "./effects";
import type { Surfaces } from "../sim/surfaces";
import { SurfaceId } from "../sim/surfaces";
import type { CartTransform } from "../sim/world";
import { POOL_SIZE } from "../sim/entities/ballShape";
import { POOL_TRANSFORM_STRIDE } from "../sim/tickConstants";

/**
 * Motion-driven effects, read off the interpolated frame rather than any sim event:
 * - **Roost** from each cart's rear wheels, in the colour of the ground it is on, scaled by speed.
 * - **Tracers** behind every fast ball.
 * - **Landing puffs** where a fast ball meets the ground: a sand plume in a bunker, spray on water,
 *   a dust puff elsewhere.
 *
 * Speeds come from frame-to-frame position deltas, so this needs nothing the sim does not already
 * publish. Fixed arrays, nothing allocated per frame.
 */

/** Below this, m/s, a cart throws nothing. */
const ROOST_MIN_SPEED = 2.5;
/** At and above this, a cart throws at the full rate. */
const ROOST_FULL_SPEED = 11;
/** Roost emissions per wheel per second at the full rate. */
const ROOST_RATE = 22;
/** Rear axle, metres behind the cart's centre, and the half-track. */
const REAR_AXLE_M = 0.85;
const HALF_TRACK_M = 0.62;
/** A ball faster than this, m/s, leaves a tracer. */
const TRACER_MIN_SPEED = 9;
/** Tracer dots per second while fast. */
const TRACER_RATE = 70;
/** A ball within this of the ground, falling faster than this, has landed. */
const LAND_HEIGHT_M = 0.35;
const LAND_MIN_SPEED = 6;
/** Seconds before the same ball can puff again. */
const LAND_COOLDOWN_S = 0.6;

export class MotionTrails {
  private readonly cartPrev: Float32Array;
  private readonly cartCarry: Float32Array;
  private readonly cartSeen: Uint8Array;
  private readonly ballPrev = new Float32Array(POOL_SIZE * 3);
  private readonly ballSeen = new Uint8Array(POOL_SIZE);
  private readonly ballCarry = new Float32Array(POOL_SIZE);
  private readonly ballCooldown = new Float32Array(POOL_SIZE);

  constructor(
    cartCount: number,
    private readonly effects: EffectsLayer,
    private readonly surfaces: Surfaces,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.cartPrev = new Float32Array(cartCount * 3);
    this.cartCarry = new Float32Array(cartCount);
    this.cartSeen = new Uint8Array(cartCount);
  }

  /** One cart's frame. `index` is its rig index; `hidden` while it is dead. */
  cart(index: number, transform: CartTransform, hidden: boolean, dt: number): void {
    const p = transform.position;
    const o = index * 3;
    if (hidden || dt <= 0 || this.cartSeen[index] === 0) {
      this.cartSeen[index] = hidden ? 0 : 1;
      this.cartPrev[o] = p.x;
      this.cartPrev[o + 1] = p.y;
      this.cartPrev[o + 2] = p.z;
      return;
    }
    const speed = Math.hypot(p.x - this.cartPrev[o]!, p.z - this.cartPrev[o + 2]!) / dt;
    this.cartPrev[o] = p.x;
    this.cartPrev[o + 1] = p.y;
    this.cartPrev[o + 2] = p.z;
    const rate = Math.min(1, Math.max(0, (speed - ROOST_MIN_SPEED) / (ROOST_FULL_SPEED - ROOST_MIN_SPEED)));
    if (rate <= 0) return;
    let carry = this.cartCarry[index]! + ROOST_RATE * rate * dt;
    if (carry < 1) {
      this.cartCarry[index] = carry;
      return;
    }
    const fx = Math.cos(transform.heading);
    const fz = Math.sin(transform.heading);
    const surface = this.surfaces.surfaceAt(p.x, p.z);
    if (surface === SurfaceId.Bridge) {
      this.cartCarry[index] = 0;
      return;
    }
    while (carry >= 1) {
      carry -= 1;
      for (const side of SIDES) {
        const wx = p.x - fx * REAR_AXLE_M - fz * side * HALF_TRACK_M;
        const wz = p.z - fz * REAR_AXLE_M + fx * side * HALF_TRACK_M;
        this.effects.roost(surface, wx, this.heightAt(wx, wz) + 0.15, wz, -fx, -fz, 0.5 + 0.5 * rate);
      }
    }
    this.cartCarry[index] = carry;
  }

  /** Every pooled ball's frame, from the interpolated pool snapshot. */
  balls(transforms: Float32Array, dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const o = i * 3;
      const x = transforms[flat]!;
      const y = transforms[flat + 1]!;
      const z = transforms[flat + 2]!;
      this.ballCooldown[i] = Math.max(0, this.ballCooldown[i]! - dt);
      if (transforms[flat + 7] !== 1) {
        this.ballSeen[i] = 0;
        continue;
      }
      if (this.ballSeen[i] === 0) {
        this.ballSeen[i] = 1;
        this.ballPrev[o] = x;
        this.ballPrev[o + 1] = y;
        this.ballPrev[o + 2] = z;
        continue;
      }
      const vy = (y - this.ballPrev[o + 1]!) / dt;
      const speed = Math.hypot(x - this.ballPrev[o]!, y - this.ballPrev[o + 1]!, z - this.ballPrev[o + 2]!) / dt;
      this.ballPrev[o] = x;
      this.ballPrev[o + 1] = y;
      this.ballPrev[o + 2] = z;

      if (speed >= TRACER_MIN_SPEED) {
        let carry = this.ballCarry[i]! + TRACER_RATE * dt;
        while (carry >= 1) {
          carry -= 1;
          this.effects.tracer(x, y, z);
        }
        this.ballCarry[i] = carry;
      }

      if (this.ballCooldown[i]! > 0 || -vy < LAND_MIN_SPEED) continue;
      const ground = this.heightAt(x, z);
      if (y - ground > LAND_HEIGHT_M) continue;
      this.ballCooldown[i] = LAND_COOLDOWN_S;
      const surface = this.surfaces.surfaceAt(x, z);
      if (surface === SurfaceId.Sand) this.effects.sandPlume(x, ground, z);
      else if (surface === SurfaceId.Water) this.effects.splash(x, ground, z);
      else this.effects.roost(surface, x, ground + 0.1, z, 0, 0, 1);
    }
  }
}

const SIDES = [-1, 1] as const;
