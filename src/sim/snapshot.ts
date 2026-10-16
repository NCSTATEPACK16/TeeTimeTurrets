import { POOL_SIZE } from "./entities/BallPool";
import type { BallPool } from "./entities/BallPool";
import type { Cart } from "./entities/Cart";
import { POOL_TRANSFORM_STRIDE } from "./frame";
import type { CartTransform } from "./frame";

/**
 * What the renderer interpolates between: each cart's transform and every pooled ball's, as a
 * previous/current pair per fixed step. Written by `Sim` and read-only to everything else.
 */
export class RenderSnapshot {
  /** Cart state from the previous fixed step, for render interpolation. */
  previousCart: CartTransform;
  /** Cart state from the most recent fixed step. */
  currentCart: CartTransform;
  /** Bot cart transforms from the previous fixed step, for render interpolation. One per bot. */
  readonly previousBotCarts: CartTransform[] = [];
  /** Bot cart transforms from the most recent fixed step. One per bot. */
  readonly currentBotCarts: CartTransform[] = [];
  /**
   * The two transforms each cart's `previous`/`current` pair is drawn from, swapped every tick:
   * the new `current` is written into whichever one `previous` is not holding. A renderer
   * interpolating between the pair never sees either overwritten under it, and a tick allocates no
   * transform at all.
   */
  private readonly cartBuffers: [CartTransform, CartTransform] = [blankTransform(), blankTransform()];
  private readonly botBuffers: [CartTransform, CartTransform][] = [];
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  previousPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Pooled ball transforms from the most recent fixed step. */
  currentPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);

  constructor(cart: Cart) {
    this.currentCart = writeTransform(cart, this.cartBuffers[0]);
    this.previousCart = this.currentCart;
  }

  /** The start of a tick: what was current becomes previous, and the pool buffers swap. */
  beginTick(): void {
    const swapPool = this.previousPoolTransforms;
    this.previousPoolTransforms = this.currentPoolTransforms;
    this.currentPoolTransforms = swapPool;

    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) {
      this.previousBotCarts[i] = this.currentBotCarts[i]!;
    }
  }

  /**
   * Snapshots each cart's own position rather than its rigid body's: a kinematic body only moves
   * when `world.step()` consumes the queued translation, so reading the body here would render
   * every cart one tick behind everything else.
   */
  syncCarts(cart: Cart, bots: readonly Cart[]): void {
    this.currentCart = writeTransform(cart, otherOf(this.cartBuffers, this.previousCart));
    for (let i = 0; i < bots.length; i++) {
      const pair = (this.botBuffers[i] ??= [blankTransform(), blankTransform()]);
      this.currentBotCarts[i] = writeTransform(bots[i]!, otherOf(pair, this.previousBotCarts[i]));
    }
  }

  /**
   * Every previous/current pair onto its current value, the pool's included, so an interpolating
   * renderer holds still: on the tick a match ends, and after a (re)start.
   */
  hold(): void {
    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) this.previousBotCarts[i] = this.currentBotCarts[i]!;
    this.previousPoolTransforms.set(this.currentPoolTransforms);
  }

  /**
   * Flattens the pool into the current buffer. An idle ball is parked far below the world, so the
   * active flag is what stops the renderer drawing thirty-two spheres at y = -1000.
   *
   * A slot transitioning idle -> active this tick also gets `previousPoolTransforms` seeded with
   * the same transform, or the renderer would lerp the ball in from wherever its slot last was.
   */
  syncPool(pool: BallPool): void {
    const buffer = this.currentPoolTransforms;
    const previous = this.previousPoolTransforms;
    const balls = pool.all;
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const ball = balls[i];
      if (!ball || ball.state === "idle") {
        buffer[flat + 7] = 0;
        continue;
      }
      const wasActive = previous[flat + 7] === 1;
      const t = ball.body.translation();
      const r = ball.body.rotation();
      buffer[flat] = t.x;
      buffer[flat + 1] = t.y;
      buffer[flat + 2] = t.z;
      buffer[flat + 3] = r.x;
      buffer[flat + 4] = r.y;
      buffer[flat + 5] = r.z;
      buffer[flat + 6] = r.w;
      buffer[flat + 7] = 1;
      if (!wasActive) {
        for (let k = 0; k < POOL_TRANSFORM_STRIDE; k++) previous[flat + k] = buffer[flat + k]!;
      }
    }
  }}

function blankTransform(): CartTransform {
  return { position: { x: 0, y: 0, z: 0 }, heading: 0, turretYaw: 0 };
}

/** Writes `cart`'s state into `out` and returns it. */
function writeTransform(cart: Cart, out: CartTransform): CartTransform {
  const p = cart.position;
  out.position.x = p.x;
  out.position.y = p.y;
  out.position.z = p.z;
  out.heading = cart.heading;
  out.turretYaw = cart.turretYaw;
  return out;
}

/** The buffer of `pair` that is not `avoid`. */
function otherOf(pair: [CartTransform, CartTransform], avoid: CartTransform | undefined): CartTransform {
  return pair[0] === avoid ? pair[1] : pair[0];
}
