import type { Vec3 } from "./course";

/**
 * The fixed tick's constants and the shapes of what it publishes for the renderer.
 *
 * A leaf with no Rapier behind it, on purpose. `world.ts` imports Rapier, whose WASM is most of the
 * game's download; anything the title screen or the clubhouse draws (a ball, a cart) that took a
 * constant from `world.ts` pulled all of it into the first chunk. `world.ts` re-exports these.
 */

/** Seconds per fixed tick. The sim advances by exactly this and nothing else. */
export const FIXED_DT = 1 / 60;

/** Floats per transform in the render snapshot buffers: x, y, z, qx, qy, qz, qw. */
export const TRANSFORM_STRIDE = 7;

/** As TRANSFORM_STRIDE, plus a trailing 1/0 active flag: an idle pool slot is parked far below
 *  the world and must not be drawn where it is parked. */
export const POOL_TRANSFORM_STRIDE = 8;

/** Aim-preview arc granularity: `Sim.previewTrajectory` writes one point every this many ticks. */
export const PREVIEW_SAMPLE_STRIDE = 4;
/** Hard cap on the ticks `previewTrajectory` integrates (~6 s at FIXED_DT), so a flat shot that
 *  never quite lands still terminates the loop. */
export const PREVIEW_MAX_TICKS = 360;
/** Upper bound on points `previewTrajectory` writes: the tick cap over the stride, plus the muzzle
 *  point and a final landing point. Sizes `createPreviewBuffer`. */
export const PREVIEW_MAX_POINTS = Math.ceil(PREVIEW_MAX_TICKS / PREVIEW_SAMPLE_STRIDE) + 2;

/** A reusable buffer of `Vec3`s for `previewTrajectory` to fill, so the arc allocates nothing per
 *  frame. A caller holds one and passes it in every frame. */
export function createPreviewBuffer(): Vec3[] {
  const buffer: Vec3[] = [];
  for (let i = 0; i < PREVIEW_MAX_POINTS; i++) buffer.push({ x: 0, y: 0, z: 0 });
  return buffer;
}
