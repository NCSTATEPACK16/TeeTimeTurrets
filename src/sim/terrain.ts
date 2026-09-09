import { createNoise2D } from "simplex-noise";
import { DECK_FREEBOARD, causewayInfluence, deriveCrossings } from "./crossing";
import { inverseSmoothstep01, smoothstep01 } from "./curves";
import type { HoleSpec, Vec3 } from "./course";
import { hashChannel, mulberry32 } from "./rng";
import { createNearestPoint, createSpline } from "./spline";
import { ellipseEdgeDistance, ellipseFalloff, polygonSignedDistance } from "./hazards";
import type { Ellipse } from "./hazards";
import type { MutableVec2, NearestPoint, Spline } from "./spline";

/**
 * The height field, as a factory over one HoleSpec.
 *
 * `heightAt` is a pure function of (x, z) for a given hole and must stay one: that is what lets
 * the authoritative server evaluate terrain without replicating a mesh or a spatial index. A
 * closure over immutable spec data preserves purity; an object with mutable state would not.
 * That is why this is `createTerrain(spec)` returning a closure rather than a `Terrain` class.
 */

/** Real cups are 108 mm. Oversized here: this is an arcade game read from a chase camera. */
export const CUP_RADIUS = 0.55;

/**
 * Flat pads blended into the terrain. The tee needs one so the ball starts level; the green
 * needs a much larger one because a putting surface that inherits the base noise is not
 * puttable.
 */
export const GREEN_RADIUS = 11;
const TEE_PAD_RADIUS = 5;

/**
 * The mown corridor, and the graded edge into rough. Full rough begins at 25 m, against the
 * hard 26 m step the shipped fairway had -- about as wide as before, but graded.
 */
export const HALF_WIDTH = 15;
export const BLEND_WIDTH = 10;
export const GREEN_BLEND = 6;

/**
 * The corridor weight at which rough becomes *the woods*.
 *
 * One constant, two consumers, and they have to agree or the course contradicts itself:
 * `src/render/Trees.ts` plants only at or above this weight, and `src/sim/placement.ts` keeps
 * bunkers strictly below it. That is what makes "sand never appears in the woods" true by
 * construction on any corridor width, rather than true for the widths somebody happened to check.
 *
 * 0.92 rather than 1.0 because a tree in the first cut looks like a mistake and one on the mown
 * surface blocks a shot the validator has already certified as playable.
 *
 * It lives *here*, beside the blend it is a weight on, rather than in `surfaces.ts` which neither
 * defines nor uses the blend -- and that placement is load-bearing, not tidiness. `placement.ts`
 * derives a module-level constant from it (`WOODS_OFFSET_M`), and `surfaces.ts` imports
 * `course.ts`, which imports `placement.ts`. Homed in `surfaces.ts` the constant sat inside that
 * import cycle, and Rollup emitted its initialiser *after* `placement.ts`'s module body: the
 * derived constant read `undefined`, became NaN, and every bunker on the course got NaN
 * coordinates, which NaN'd `heightAt` and left the built game rendering nothing but sky. `vitest`
 * never saw it because an unbundled ESM graph evaluates the cycle in the other order. `terrain.ts`
 * is strictly upstream of `placement.ts` with no path back, so its initialisers always run first.
 */
export const WOODS_WEIGHT = 0.92;

/**
 * How a placed hazard is shaped, as opposed to merely classified (docs/COURSE_PIPELINE.md §5).
 *
 * A hazard that is only a classification is paint: water would be a blue region on a hillside and
 * a bunker flat ground coloured tan, and a ball would roll across both unchanged. These carve the
 * height field so the hazard is a real feature the physics runs over.
 *
 * `WATER_DEPTH` is measured below `spec.waterLevel`, not below local ground, so the basin floor is
 * flat and the rendered water plane always has clearance beneath it. `WATER_SHORE` is the run from
 * the bank to full depth -- long enough that a ball rolls down a beach rather than dropping off a
 * kerb, and short enough that a 12 m creek still gets wet in the middle.
 *
 * `BUNKER_DEPTH` is deliberately shallow. It has to read as a dish from a chase camera without
 * adding enough cross-slope at the corridor edge to trip `validateHole` check 4: over the check's
 * 20 m sampling arm, 0.6 m is a 0.03 gradient against a 0.0699 limit, so a bunker at the fairway
 * edge costs about 40% of the camber budget rather than all of it.
 */
export const WATER_DEPTH = 1.5;
export const WATER_SHORE = 6;
export const BUNKER_DEPTH = 0.6;

/**
 * Slope budgets, as tan(theta). GRAD_GREEN and GRAD_FAIRWAY are the `crr` values already in
 * SURFACES: the rest condition surfaces.ts documents is crr >= tan(theta), so a surface's
 * rolling resistance *is* the steepest grade a ball will hold on it.
 *
 * GRAD_ROUGH is deliberately 0.28, above the rough's own 0.22 rest threshold. It is the
 * unmasked octave sum (0.03 + 0.07 + 0.18), so the rough simply runs unbudgeted -- a ball on a
 * steep rough patch keeps rolling rather than settling, which is wanted: it runs out onto
 * flatter ground instead of parking on a hillside.
 */
export const GRAD_GREEN = 0.06;
export const GRAD_FAIRWAY = 0.11;
export const GRAD_ROUGH = 0.28;

/**
 * Max ||grad S|| of the installed simplex-noise build, measured directly rather than derived:
 * central differences at h = 1e-4 over 1,002,001 samples of a 20x20 domain gave max 7.333
 * (rms 2.955, mean 2.672).
 *
 * Neither published figure was right -- the research's 2.5 is the *mean* gradient, and this
 * module previously used 2*pi. Every amplitude below solves A = G / (f * k) with this k, so it
 * is a property of the installed dependency that a version bump can silently invalidate. That
 * is why `npm run probe` asserts it rather than this comment being the only record.
 */
export const NOISE_MAX_GRADIENT = 7.333;

/** Three octaves. G is the octave's share of the slope budget; A solves A = G / (f * k). */
const F_MICRO = 0.1;
const F_MESO = 0.02;
const F_MACRO = 0.005;
const G_MICRO = 0.03;
const G_MESO = 0.07;
const G_MACRO = 0.18;
const A_MICRO = G_MICRO / (F_MICRO * NOISE_MAX_GRADIENT);
const A_MESO = G_MESO / (F_MESO * NOISE_MAX_GRADIENT);
const A_MACRO = G_MACRO / (F_MACRO * NOISE_MAX_GRADIENT);

/**
 * Corridor half-width at a spline parameter, interpolated between the per-control-point widths.
 *
 * `spec.corridor` has one entry per control point and `t` runs 0..1 across the whole spline, so
 * this is a piecewise-linear lookup. Linear rather than smooth on purpose: the widths come from
 * three authored numbers, and a spline through them would overshoot -- a corridor that pinches to
 * 10 m in the middle would bulge past its own endpoints on the way there.
 *
 * Exported because four callers need exactly this and a second copy of it would be a second
 * corridor: `heightAt`'s carving mask, `budgetAt`'s slope allowance, `surfaces.corridorWeight`,
 * and hazard placement in `placement.ts`.
 */
export function halfWidthAt(corridor: readonly number[], t: number): number {
  const n = corridor.length;
  if (n === 0) return HALF_WIDTH;
  if (n === 1) return corridor[0]!;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const scaled = clamped * (n - 1);
  const i = Math.min(n - 2, Math.floor(scaled));
  const frac = scaled - i;
  return corridor[i]! + (corridor[i + 1]! - corridor[i]!) * frac;
}

/**
 * Re-exported from `curves.ts` rather than defined here. The curve moved to a leaf so `crossing.ts`
 * could use it for the causeway's shoulders without this module and that one importing each other;
 * every existing `from "./terrain"` import of these two names still resolves.
 */
export { inverseSmoothstep01, smoothstep01 };

/**
 * Injected randomness for the noise permutation. Defaulted from the spec's seed channel; the
 * parameter exists because AGENTS.md wants seeded randomness injected rather than reached for,
 * and because it keeps `createTerrain` testable -- a test can substitute a fixed or scripted
 * source instead of depending on the spec's seed-derived channel.
 */
export interface TerrainSources {
  /** Optional so a caller can set `crossings` alone without also having to supply the noise
   *  source -- passing the wrong RNG here silently regenerates every hole. */
  readonly height?: () => number;
  /**
   * Shape the derived water crossings into the height field. Defaults to true, which is what a
   * played hole wants.
   *
   * **`generateHole` sets it false, and that is spec D9 made mechanical.** Crossings are derived
   * *after* a hole validates, so `validateHole` must be shown the un-bridged hole: a causeway is a
   * built structure crossing a pond, its shoulders are far steeper than the fairway grade budget,
   * and terrain carrying one fails check 3 on the very hole the crossing exists to make playable.
   * Routing would then move -- par, corridor, field size and the acceptance rate with it -- which is
   * exactly what D9 forbids. Holes 2, 13 and 15 gain an alternative to their forced carries rather
   * than being re-judged.
   */
  readonly crossings?: boolean;
}

export interface Terrain {
  readonly spec: HoleSpec;
  readonly spline: Spline;
  heightAt(x: number, z: number): number;
  buildHeightfield(): Float32Array;
  readonly teePosition: Vec3;
  readonly cupPosition: Vec3;
}

/**
 * A flattened patch blended into the terrain. Circular (`radius`) for the tee; the green carries
 * an `ellipse` instead, so a long green is flat along its whole length rather than only inside
 * the circle that fits in it.
 */
interface Pad {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly ellipse?: Ellipse;
}

/** Channel 0 of the spec's seed. See the spec's channel table, §3 "Seeding". */
export function heightChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 0);
}

export function createTerrain(spec: HoleSpec, sources?: TerrainSources): Terrain {
  const random = sources?.height ?? mulberry32(heightChannel(spec));
  // Derived once per hole, after routing. Empty on the ten of eighteen briefs with no water, so
  // `shapeHazards` pays nothing for it there -- and empty for `validateHole`, always. See
  // `TerrainSources.crossings`.
  const crossings = sources?.crossings === false ? [] : deriveCrossings(spec);
  const noise2D = createNoise2D(random);

  const spline = createSpline(spec.control);

  // Closure-owned scratch: heightAt runs inside the fixed tick, where allocation is banned.
  const nearestScratch: NearestPoint = createNearestPoint();
  const centreScratch: MutableVec2 = { x: 0, z: 0 };

  /**
   * The slope a point is allowed, blended green -> fairway -> rough. `corridorDistance` is the
   * distance to the centreline, passed in rather than measured here so the carving code can ask
   * for the budget *at the centreline* (distance 0) without a second spline query.
   */
  function budgetAt(
    worldX: number,
    worldZ: number,
    corridorDistance: number,
    t: number,
  ): number {
    const tGreen = smoothstep01(ellipseEdgeDistance(worldX, worldZ, spec.green) / GREEN_BLEND);
    const tCorridor = smoothstep01((corridorDistance - halfWidthAt(spec.corridor, t)) / BLEND_WIDTH);
    const mown = GRAD_GREEN + (GRAD_FAIRWAY - GRAD_GREEN) * tGreen;
    return mown + (GRAD_ROUGH - mown) * tCorridor;
  }

  /**
   * Each octave takes what the budget leaves. Micro is never masked -- it is the surface
   * ripple, and 0.03 fits under even the green's 0.06.
   *
   * smoothstep01, not a raw clamp, on the scale terms: a clamp is C0 but not C1, and a mask
   * whose derivative steps produces a slope discontinuity in H. smoothstep01 has zero
   * derivative at both ends, so H stays C1.
   *
   * The budget is the design target, not the guarantee -- it assumes all three octaves peak at
   * the same coordinate, and smoothstep01(t) > t for t > 0.5 lets the transition band sit
   * slightly over. The rejection sampler in course.ts is the enforcement.
   */
  function noiseHeightAt(
    worldX: number,
    worldZ: number,
    corridorDistance: number,
    t: number,
  ): number {
    let remaining = budgetAt(worldX, worldZ, corridorDistance, t) - G_MICRO;
    const mesoScale = smoothstep01(remaining / G_MESO);
    remaining -= mesoScale * G_MESO;
    const macroScale = smoothstep01(remaining / G_MACRO);
    return (
      A_MICRO * noise2D(worldX * F_MICRO, worldZ * F_MICRO) +
      A_MESO * noise2D(worldX * F_MESO, worldZ * F_MESO) * mesoScale +
      A_MACRO * noise2D(worldX * F_MACRO, worldZ * F_MACRO) * macroScale
    );
  }

  // Pad heights are sampled from the base noise once at construction so heightAt can flatten
  // toward the terrain's own local height without recursing into itself. The pad centres sit on
  // the corridor, so distance 0 is correct and matches the carved corridor height by
  // construction -- it is the same value the carving in heightAt gives a point on the centreline.
  const pads: readonly Pad[] = [
    { ...spec.tee, radius: TEE_PAD_RADIUS, height: noiseHeightAt(spec.tee.x, spec.tee.z, 0, 0) },
    {
      ...spec.cup,
      radius: Math.max(spec.green.radiusX, spec.green.radiusZ),
      height: noiseHeightAt(spec.cup.x, spec.cup.z, 0, 1),
      ellipse: spec.green,
    },
  ];

  /**
   * Carving. Every point in the corridor is handed the height of the centreline point it is
   * nearest to, so lateral camber inside the corridor is exactly zero by construction while the
   * longitudinal profile is inherited from the noise and stays interesting. Outside the blend
   * band the point keeps its own height.
   *
   * H_spline(t) is `noiseHeightAt` evaluated at the centreline point with a corridor distance of
   * ZERO -- the corridor's budget, not the querying point's. Reusing the caller's masks here
   * gives the corridor rough-grade undulation and fails the camber test; it is the one trap in
   * this function.
   *
   * Pads blend toward the terrain height *at the pad*, not toward absolute 0. Multiplying the
   * whole height by (1 - flatten) pins a pad to y=0 regardless of where the surrounding ground
   * sits -- that left the tee on a 1.1 m pinnacle with a 26 deg drop-off inside the first 4 m.
   */
  function heightAt(worldX: number, worldZ: number): number {
    spline.nearestInto(worldX, worldZ, nearestScratch);
    const half = halfWidthAt(spec.corridor, nearestScratch.t);
    const mask = smoothstep01((nearestScratch.distance - half) / BLEND_WIDTH);

    let height: number;
    // Pad flattening keys off this point rather than (worldX, worldZ) directly. Inside the
    // corridor the query point's own coordinates are the wrong key: a point on the centreline
    // near the tee sits inside TEE_PAD_RADIUS while a point at the same t but offset 12 m
    // laterally does not, so flattening by raw distance would reintroduce the exact lateral
    // camber the carving above just eliminated. Blending this key point from the centreline
    // (mask 0) to the query point (mask 1) the same way the height blends keeps the pad weight
    // C1 across the corridor edge too.
    let padX = worldX;
    let padZ = worldZ;
    if (mask >= 1) {
      height = noiseHeightAt(worldX, worldZ, nearestScratch.distance, nearestScratch.t);
    } else {
      spline.pointInto(nearestScratch.t, centreScratch);
      const centre = noiseHeightAt(centreScratch.x, centreScratch.z, 0, nearestScratch.t);
      height =
        mask <= 0
          ? centre
          : centre +
            (noiseHeightAt(worldX, worldZ, nearestScratch.distance, nearestScratch.t) - centre) *
              mask;
      padX = centreScratch.x + (worldX - centreScratch.x) * mask;
      padZ = centreScratch.z + (worldZ - centreScratch.z) * mask;
    }

    // Tee and green keep an additional local flattening on top of the corridor: a putting
    // surface needs to be flatter than the corridor alone delivers.
    for (const pad of pads) {
      // An elliptical pad flattens on its own falloff; a circular one on radial distance. Both
      // are 1 at the centre and 0 at the rim, so the blend below is identical either way.
      const weight =
        pad.ellipse === undefined
          ? (() => {
              const distance = Math.hypot(padX - pad.x, padZ - pad.z);
              return distance >= pad.radius ? 0 : smoothstep01(1 - distance / pad.radius);
            })()
          : smoothstep01(ellipseFalloff(padX, padZ, pad.ellipse));
      if (weight <= 0) continue;
      height += (pad.height - height) * weight;
    }

    return shapeHazards(worldX, worldZ, height);
  }

  /**
   * Hazard shaping, applied last so it cuts through the corridor carving and the pads rather than
   * being smoothed away by them. That ordering is the whole point: a water crossing on hole 2 has
   * to be a ditch *through* the fairway, and a fairway bunker a dish *in* the mown surface. Doing
   * this before the carving would let the corridor flatten both back out.
   *
   * Both loops are no-ops on a hole with no hazards -- ten of the eighteen briefs have no water --
   * so the cost lands only where something was placed.
   */
  function shapeHazards(worldX: number, worldZ: number, base: number): number {
    let height = base;

    for (const poly of spec.water) {
      const signed = polygonSignedDistance(worldX, worldZ, poly);
      if (signed >= 0) continue;
      // 0 at the bank, 1 once WATER_SHORE metres inside. smoothstep01 rather than a clamp so
      // the shoreline has no slope discontinuity for the ball to catch on.
      const weight = smoothstep01(-signed / WATER_SHORE);
      // `min`, not the floor outright: a basin excavates, it never fills. Lerping straight to
      // the floor would *raise* ground that already sat deeper than it -- a natural hollow inside
      // the polygon would come back up to meet the pond bottom, which is backwards. This way the
      // deep spot stays a deep spot and the guarantee still holds: at full weight the ground is
      // at or below the floor, so it is always under the rendered water plane.
      const floor = Math.min(height, spec.waterLevel - WATER_DEPTH);
      height += (floor - height) * weight;
    }

    for (const b of spec.bunkers) {
      const falloff = ellipseFalloff(worldX, worldZ, b);
      if (falloff <= 0) continue;
      height -= BUNKER_DEPTH * smoothstep01(falloff);
    }

    // The causeway, **after the water loop and not before it**. The two overlap by construction --
    // a crossing is only derived where the centreline runs through a pond -- so a deck raised first
    // is a deck the excavation immediately takes back down to the pond floor, 1.5 m under the water
    // line. Ordering is the whole of it, and `terrain.test.ts` asserts the deck survives the cut.
    //
    // `max`, not a lerp: a causeway fills, it never excavates. Where the bank is already higher
    // than the deck -- the abutments run onto dry ground at both ends -- the ground stays where it
    // is rather than being dug down to meet the deck.
    if (crossings.length > 0) {
      const influence = causewayInfluence(crossings, worldX, worldZ);
      if (influence > 0) {
        const deck = spec.waterLevel + DECK_FREEBOARD;
        height = Math.max(height, height + (deck - height) * influence);
      }
    }

    return height;
  }

  /**
   * Rapier heightfield storage is column-major: heights[row + col * (nrows + 1)]. Row index
   * maps to world Z, column index maps to world X.
   */
  function buildHeightfield(): Float32Array {
    const n = spec.cells;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let col = 0; col <= n; col++) {
      const worldX = (col / n - 0.5) * spec.fieldSize;
      for (let row = 0; row <= n; row++) {
        const worldZ = (row / n - 0.5) * spec.fieldSize;
        heights[row + col * (n + 1)] = heightAt(worldX, worldZ);
      }
    }
    return heights;
  }

  return {
    spec,
    spline,
    heightAt,
    buildHeightfield,
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z) + 0.3, z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}
