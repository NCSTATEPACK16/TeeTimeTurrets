import type { Vec3 } from "./course";

/**
 * The sim's clock and the shapes of what it hands the renderer, without the sim.
 *
 * Split out of `world.ts` so the renderer, the HUD and the page's entry can size their buffers and
 * run the loop without importing the module that imports Rapier. Rapier is most of the bundle and
 * is loaded on the first PLAY (`tools/entryImports.test.mjs`); anything here must stay free of it.
 * `world.ts` re-exports all of it, so sim code and tests keep importing from there.
 */

/** DOM-free physics module. No rendering, no input handling, no globals — just state in, state out. */
export const FIXED_DT = 1 / 60;

/** Floats per transform in the render snapshot buffers: x, y, z, qx, qy, qz, qw. */
export const TRANSFORM_STRIDE = 7;

/** As TRANSFORM_STRIDE, plus a trailing 1/0 active flag: an idle pool slot is parked far below
 *  the world and must not be drawn where it is parked. */
export const POOL_TRANSFORM_STRIDE = 8;

/** Balls in the shared pool: every ball in flight or on the ground, every cart's. */
export const POOL_SIZE = 32;

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

export interface CartTransform {
  position: Vec3;
  /** Chassis yaw, radians. */
  heading: number;
  /** Turret yaw, radians, absolute in world space. */
  turretYaw: number;
}
