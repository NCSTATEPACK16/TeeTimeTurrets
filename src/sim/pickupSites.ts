import { DEPOT_RADIUS_M, FOOD_CART_PLACEMENT, placedAt } from "./clubhouseLayout";
import { metresNorthOf } from "./courseBarrier";
import { toCourseFrame } from "./courseLayout";
import type { CourseWorld } from "./courseWorld";
import { SurfaceId } from "./surfaces";
import type { Bounds } from "./courseLayout";
import type { Vec2 } from "./mapGeometry";
import { hashChannel, mulberry32 } from "./rng";

/**
 * Where pickups stand: a depot ring of six around the food cart, plus a seeded variable-radius
 * blue-noise scatter over drivable ground (`docs/art/specs/pickups.md`, and the Stage D spec
 * `docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md`).
 *
 * Pure and computed once per course. Nothing here is simulated yet: collection, cooldowns and
 * effects are `sim/pickups.ts`'s job (issue #76). Kept in `src/sim/**` so that module and the
 * renderer read the same sites.
 */

export const PICKUP_TYPES = ["bucket", "hot_dog", "drink"] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];

export interface PickupSite {
  readonly x: number;
  readonly z: number;
  readonly type: PickupType;
  /** True for the six at the clubhouse depot. */
  readonly depot: boolean;
}

/** What placement needs to know about the ground. Structural, so tests need no real course. */
export interface SiteGround {
  readonly bounds: Bounds;
  /** Can a cart drive here? Not water, not across the road. */
  drivable(x: number, z: number): boolean;
  /** Where the scatter is dense: the cups. The clubhouse is added by `placePickupSites`. */
  readonly hotspots: readonly Vec2[];
}

/** Scatter target (Stage D: "lands near 50 sites"). */
export const SCATTER_TARGET = 50;
/** Minimum spacing near a cup or the clubhouse, and far out in the rough. */
export const SCATTER_RADIUS_NEAR_M = 45;
export const SCATTER_RADIUS_FAR_M = 140;
/** Spacing ramps from near to far over this distance, starting this far out. */
const RAMP_START_M = 30;
const RAMP_LENGTH_M = 170;
/** No scatter site inside the complex: covers the clubhouse, both barns, the lot and the depot. */
export const COMPLEX_CLEAR_M = 45;
/** Dart throws before giving up short of the target. */
const CANDIDATES = 6000;

export function placePickupSites(
  ground: SiteGround,
  clubhouse: Vec2,
  seed: number,
  zone?: readonly Vec2[],
): PickupSite[] {
  const sites: PickupSite[] = depotRing(ground, clubhouse);
  const inZone = (x: number, z: number): boolean => zone === undefined || insidePolygon(zone, x, z);

  const hotspots = [...ground.hotspots, clubhouse];
  const radiusAt = (x: number, z: number): number => {
    let nearest = Infinity;
    for (const h of hotspots) nearest = Math.min(nearest, Math.hypot(h.x - x, h.z - z));
    const t = Math.min(1, Math.max(0, (nearest - RAMP_START_M) / RAMP_LENGTH_M));
    return SCATTER_RADIUS_NEAR_M + t * (SCATTER_RADIUS_FAR_M - SCATTER_RADIUS_NEAR_M);
  };

  const random = mulberry32(hashChannel(seed, 0x51735));
  const { minX, minZ, maxX, maxZ } = ground.bounds;
  const scatter: PickupSite[] = [];
  for (let i = 0; i < CANDIDATES && scatter.length < SCATTER_TARGET; i++) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (Math.hypot(x - clubhouse.x, z - clubhouse.z) < COMPLEX_CLEAR_M) continue;
    if (!inZone(x, z) || !ground.drivable(x, z)) continue;
    const r = radiusAt(x, z);
    if (scatter.some((s) => Math.hypot(s.x - x, s.z - z) < r)) continue;
    // Round-robin, so the three counts differ by at most one.
    scatter.push({ x, z, type: PICKUP_TYPES[scatter.length % PICKUP_TYPES.length]!, depot: false });
  }
  return sites.concat(scatter);
}

/**
 * Six sites on a 6 m circle around the food cart, from +x at 60 degree steps, typed bucket, hot
 * dog, drink, repeating. A site on undrivable ground rotates +10 degrees up to three times, then
 * is dropped.
 */
function depotRing(ground: SiteGround, clubhouse: Vec2): PickupSite[] {
  const centre = placedAt(clubhouse, FOOD_CART_PLACEMENT);
  const sites: PickupSite[] = [];
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      const a = (i * 60 + attempt * 10) * (Math.PI / 180);
      const x = centre.x + Math.cos(a) * DEPOT_RADIUS_M;
      const z = centre.z + Math.sin(a) * DEPOT_RADIUS_M;
      if (!ground.drivable(x, z)) continue;
      sites.push({ x, z, type: PICKUP_TYPES[i % PICKUP_TYPES.length]!, depot: true });
      break;
    }
  }
  return sites;
}

/** Even-odd ray cast. */
export function insidePolygon(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The shipped course as `SiteGround`: drivable means not water and at least 5 m north of the
 * road, and the cups (in course frame) are the dense spots.
 */
export function courseSiteGround(world: CourseWorld): SiteGround {
  const cup = { x: 0, z: 0 };
  const hotspots = world.holes.map((h) => {
    toCourseFrame(h.placement, h.spec.cup.x, h.spec.cup.z, cup);
    return { x: cup.x, z: cup.z };
  });
  return {
    bounds: world.terrain.bounds,
    drivable: (x, z) =>
      world.surfaces.surfaceAt(x, z) !== SurfaceId.Water && metresNorthOf(world.southBoundary, x, z) >= 5,
    hotspots,
  };
}
