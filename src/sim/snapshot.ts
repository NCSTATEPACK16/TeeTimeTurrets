/**
 * The render snapshot: each cart's and each pooled ball's transform for the current tick, and
 * holding the previous ones still when the match freezes.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { POOL_SIZE } from "./entities/BallPool";
import { POOL_TRANSFORM_STRIDE } from "./tickConstants";
import type { Sim } from "./world";
import { writeCartTransform, copyCartTransform } from "./rigs";

/** Every previous cart transform made equal to its current one, so interpolation holds still. */
export function holdPrevious(sim: Sim): void {
  copyCartTransform(sim.currentCart, sim.previousCart);
  for (let i = 0; i < sim.currentBotCarts.length; i++) {
    copyCartTransform(sim.currentBotCarts[i]!, sim.previousBotCarts[i]!);
  }
}

/**
 * Snapshots each cart's own position rather than its rigid body's: a kinematic body only moves
 * when `world.step()` consumes the queued translation, so reading the body here would render
 * every cart one tick behind everything else.
 */
export function syncCurrentCart(sim: Sim): void {
  writeCartTransform(sim.cart, sim.currentCart);
  for (let i = 0; i < sim.bots.length; i++) {
    writeCartTransform(sim.bots[i]!, sim.currentBotCarts[i]!);
  }
}

/**
 * Flattens the pool into the current buffer. An idle ball is parked far below the world, so the
 * active flag is what stops the renderer drawing thirty-two spheres at y = -1000.
 *
 * A slot transitioning idle -> active sim tick also gets `previousPoolTransforms` seeded with
 * the same transform, or the renderer would lerp the ball in from wherever its slot last was.
 */
export function syncCurrentPool(sim: Sim): void {
  const buffer = sim.currentPoolTransforms;
  const previous = sim.previousPoolTransforms;
  const balls = sim.ballPool.all;
  for (let i = 0; i < POOL_SIZE; i++) {
    const flat = i * POOL_TRANSFORM_STRIDE;
    const ball = balls[i];
    if (!ball || ball.state === "idle") {
      buffer[flat + 7] = 0;
      continue;
    }
    const wasActive = previous[flat + 7] === 1;
    // Position from the pool's cache, filled by `sync` a moment ago; the rotation is only drawn,
    // so it is the one thing still asked of Rapier here.
    const r = ball.body.rotation();
    buffer[flat] = ball.position[0]!;
    buffer[flat + 1] = ball.position[1]!;
    buffer[flat + 2] = ball.position[2]!;
    buffer[flat + 3] = r.x;
    buffer[flat + 4] = r.y;
    buffer[flat + 5] = r.z;
    buffer[flat + 6] = r.w;
    buffer[flat + 7] = 1;
    if (!wasActive) {
      for (let k = 0; k < POOL_TRANSFORM_STRIDE; k++) previous[flat + k] = buffer[flat + k]!;
    }
  }
}
