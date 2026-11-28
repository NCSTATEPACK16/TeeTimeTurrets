/**
 * The tee box (Stage 5): a raised, mown rectangle round each hole's tee, its long side along the
 * hole's first leg. One shape with two consumers -- `terrain.ts` raises the ground under it and
 * `surfaces.ts` calls it `SurfaceId.Tee` -- so the box a cart climbs onto is the box the ground is
 * drawn and classified as. See the Stage 5 spec, §2.
 *
 * DOM-free and allocation-free per query: `surfaces.ts` asks it inside the fixed tick.
 */
import type { Vec2 } from "./course";

/** Half the box along the hole: 10 m long. */
export const TEE_BOX_HALF_LENGTH_M = 5;
/** Half the box across the hole: 7 m wide. */
export const TEE_BOX_HALF_WIDTH_M = 3.5;
/** How far the box stands above the flattened pad round the tee. */
export const TEE_BOX_RAISE_M = 0.25;
/** The bevel the raise falls over, outside the box. Steepest point: a 0.19 grade. */
export const TEE_BOX_BEVEL_M = 2;
/** The drawn edge: the mask's green weight rises from 0 to 1 over this, just inside the box. */
export const TEE_BOX_EDGE_M = 1;

export interface TeeBox {
  readonly x: number;
  readonly z: number;
  /** Unit vector down the hole. */
  readonly ax: number;
  readonly az: number;
}

/** The box of a hole whose centreline starts at `control[0]`, the tee. */
export function teeBoxOf(spec: { readonly tee: Vec2; readonly control: readonly Vec2[] }): TeeBox {
  const next = spec.control[1] ?? spec.tee;
  const dx = next.x - spec.tee.x;
  const dz = next.z - spec.tee.z;
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: spec.tee.x, z: spec.tee.z, ax: dx / len, az: dz / len } : { x: spec.tee.x, z: spec.tee.z, ax: 1, az: 0 };
}

/** Metres from the box's edge: 0 or less inside it, the distance to the rectangle outside. */
export function teeBoxDistance(box: TeeBox, x: number, z: number): number {
  const dx = x - box.x;
  const dz = z - box.z;
  const along = Math.abs(dx * box.ax + dz * box.az) - TEE_BOX_HALF_LENGTH_M;
  const across = Math.abs(-dx * box.az + dz * box.ax) - TEE_BOX_HALF_WIDTH_M;
  if (along <= 0 && across <= 0) return Math.max(along, across);
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
}

/** True on the box. */
export function onTeeBox(box: TeeBox, x: number, z: number): boolean {
  return teeBoxDistance(box, x, z) <= 0;
}
