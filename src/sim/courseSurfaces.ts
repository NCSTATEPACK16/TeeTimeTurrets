/**
 * What the ground is made of, course-wide.
 *
 * `courseTerrain.ts` blends eighteen holes' heights into one surface; this blends their materials
 * over exactly the same weights, so ground that drives like fairway is ground that looks like
 * fairway. Both get them from `CourseTerrain.weightsInto`, which is why they cannot drift.
 *
 * **Continuous things blend; discrete things do not.** `tuningAt` is what a rolling ball and a
 * driving cart read, and it is blended -- a seam in it would be a seam a player feels as the cart
 * changes speed. `surfaceAt` is a classification and `weightsAt`'s sand/water/bridge flags are
 * hard-edged by design (a bunker lip is abrupt, and a plank deck against open water is the most
 * abrupt boundary on the course), so those come from whichever hole owns the point rather than
 * from an average that would invent a half-sand.
 *
 * Where no hole reaches, everything is rough: the interstitial ground between the corridors is
 * the same material a hole's own outfield is, from the same table.
 *
 * DOM-free and allocation-free per query, as `surfaces.ts` is and for the same reasons.
 */
import type { CourseTerrain } from "./courseTerrain";
import { toHoleFrame } from "./courseLayout";
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaceWeights } from "./surfaces";
import type { MutableSurfaceTuning, SurfaceWeights, Surfaces } from "./surfaces";

const ROUGH = SURFACES[SurfaceId.Rough];

/**
 * `surfaces[i]` must be the surfaces of `terrain.holes[i]` -- same order, same holes. Passed in
 * rather than built here so a caller that already has them (the renderer, `Sim`) does not build
 * eighteen more.
 */
export function createCourseSurfaces(
  terrain: CourseTerrain,
  surfaces: readonly Surfaces[],
): Surfaces {
  // Closure-owned scratch: every function here runs inside the fixed tick, and `weightsAt` runs
  // once per texel when the renderer bakes its surface mask.
  const local = { x: 0, z: 0 };
  const holeTuning = createSurfaceTuning();
  const holeWeights = createSurfaceWeights();

  const weights = new Float32Array(terrain.holes.length);

  /** This point in one hole's own frame. */
  function localTo(index: number, x: number, z: number): void {
    toHoleFrame(terrain.holes[index]!.placement, x, z, local);
  }

  function surfaceAt(x: number, z: number): SurfaceId {
    const owner = terrain.weightsInto(x, z, weights);
    if (owner < 0) return SurfaceId.Rough;
    localTo(owner, x, z);
    return surfaces[owner]!.surfaceAt(local.x, local.z);
  }

  function tuningAt(x: number, z: number, out: MutableSurfaceTuning): void {
    const owner = terrain.weightsInto(x, z, weights);
    let sumWeight = 0;
    let rolling = 0;
    let bounceScale = 0;
    let cartSpeedScale = 0;
    for (let i = 0; i < weights.length; i++) {
      const weight = weights[i]!;
      if (weight <= 0) continue;
      localTo(i, x, z);
      surfaces[i]!.tuningAt(local.x, local.z, holeTuning);
      sumWeight += weight;
      rolling += weight * holeTuning.rolling;
      bounceScale += weight * holeTuning.bounceScale;
      cartSpeedScale += weight * holeTuning.cartSpeedScale;
    }

    if (owner < 0) {
      out.rolling = ROUGH.rolling;
      out.bounceScale = ROUGH.bounceScale;
      out.cartSpeedScale = ROUGH.cartSpeedScale;
      out.isHazard = false;
      return;
    }
    // What the holes did not claim is rough, which at a sum of 1 contributes nothing. The
    // weights arrive normalised, so this term can never be negative.
    const rest = 1 - sumWeight;
    out.rolling = rolling + ROUGH.rolling * rest;
    out.bounceScale = bounceScale + ROUGH.bounceScale * rest;
    out.cartSpeedScale = cartSpeedScale + ROUGH.cartSpeedScale * rest;

    // Not blended: a stroke-and-distance hazard is a fact about a point, not a proportion of one.
    // It answers to whichever hole owns the ground, exactly as `surfaceAt` does.
    localTo(owner, x, z);
    out.isHazard = surfaces[owner]!.surfaceAt(local.x, local.z) === SurfaceId.Water;
  }

  function weightsAt(x: number, z: number, out: SurfaceWeights): void {
    const owner = terrain.weightsInto(x, z, weights);
    if (owner < 0) {
      // 1 is "off the green" and "in full rough" -- the far end of both falloffs, which is what
      // ground no hole reaches is.
      out.green = 1;
      out.corridor = 1;
      out.sand = 0;
      out.water = 0;
      out.bridge = 0;
      return;
    }

    let sumWeight = 0;
    let green = 0;
    let corridor = 0;
    for (let i = 0; i < weights.length; i++) {
      const weight = weights[i]!;
      if (weight <= 0) continue;
      localTo(i, x, z);
      surfaces[i]!.weightsAt(local.x, local.z, holeWeights);
      sumWeight += weight;
      green += weight * holeWeights.green;
      corridor += weight * holeWeights.corridor;
    }
    const rest = 1 - sumWeight;
    out.green = green + rest;
    out.corridor = corridor + rest;

    // Hard-edged, from the hole that owns the point: a bunker lip is abrupt and a plank deck
    // against open water is the most abrupt boundary on the course. `holeWeights` already holds
    // the owner's answer when the owner is the last hole in the loop, so it is re-read rather
    // than assumed.
    localTo(owner, x, z);
    surfaces[owner]!.weightsAt(local.x, local.z, holeWeights);
    out.sand = holeWeights.sand;
    out.water = holeWeights.water;
    out.bridge = holeWeights.bridge;
  }

  return { surfaceAt, tuningAt, weightsAt };
}
