import type * as THREE from "three";
import { FAIRWAY_STRIPE_M, GREEN_STRIPE_M, STRIPE_CONTRAST } from "./biomes";
import {
  DETAIL_FADE_END_M,
  DETAIL_FADE_START_M,
  DETAIL_RANGE,
  GROUND_LAYERS,
  LAYER,
  MACRO_SCALE_M,
  MACRO_STRENGTH,
} from "./groundLayers";
import { GROUND_WARP_GLSL } from "./groundWarp";

/** How much ground detail a preset draws. See `QualityPreset.groundDetail`. */
export type GroundDetailMode = "off" | "near" | "full";

/**
 * Detail tuning that is not per layer (`groundLayers.ts` holds the per-layer numbers).
 */
export const GROUND_DETAIL_TUNING = {
  /** How strongly the layers' normal maps tilt the shading normal. */
  normalStrength: 0.9,
  /**
   * The layers' roughness maps are remapped into this narrow, matte band before use. Grass here
   * is a toy surface at roughness 0.95; the scans' own values (about 0.5) would let it reflect
   * the sky at the chase camera's grazing angle. The map still varies the sheen texel to texel.
   */
  roughnessFloor: 0.86,
  roughnessCeil: 1.0,
  /**
   * Mow-stripe sheen: grass in alternate bands is laid in opposite directions, so the bands tilt
   * the normal this far along the mow direction, and shift roughness by `sheenRoughness`. Looking
   * down-sun and up-sun the light and dark bands swap, as on a real fairway.
   */
  sheenTilt: 0.12,
  sheenRoughness: 0.035,
  /** Detail strength on the putting surface, as a fraction of the fairway's: a green is finer. */
  greenStrength: 0.5,
  /** The macro sample keeps working this far out, metres, after the fine detail has faded. */
  macroFadeStartM: 150,
  macroFadeEndM: 420,
  /** The mask warp fades to nothing this close to a tile's edge, metres, so tiles meet. */
  warpEdgeM: 3,
} as const;

/**
 * The ground's shader, shared by the one-hole ground and the course-wide one.
 *
 * There is one rule for how a surface mask becomes a colour -- green blended to fairway blended
 * to rough, sand and water over the top, mowing stripes fading out as the grass gets long -- and
 * it is the same rule `src/sim/surfaces.ts` blends its tuning with. Two copies of it in GLSL is
 * two places to tune and one place to forget.
 *
 * Both callers hand it the same things through uniforms:
 *
 * - `uMask`   RGBA, R = green weight, G = corridor weight, B = sand flag, A = water flag.
 * - `uMaskExtent` / `uMaskOffset` map world XZ onto the mask: `uv = xz / extent + offset`. A hole
 *   centres its mask on its own origin (offset 0.5); a course tile puts it at the tile's corner.
 *
 * They differ in two things, and `biomeBlend` is the switch:
 *
 * - **Palette.** One hole has one biome. The course crosses three, so its palette is mixed per
 *   vertex from the weights in the `color` attribute -- parkland, links, marsh in R, G, B.
 * - **Mow direction.** One hole mows at one angle. The course mows each hole its own way, so the
 *   direction rides in on an `aMow` attribute and rotates across the ground rather than stepping
 *   at a tile edge. It only shows on mown grass, and mown grass belongs to exactly one hole.
 */
export interface GroundShaderOptions {
  /**
   * The course-wide ground rather than one hole's.
   *
   * Three things change together, which is why this is one flag and not three. The mask arrives
   * as the material's own `map` rather than as a uniform, so every tile shares one compiled
   * program and differs only in the texture three binds per material -- a uniform would give each
   * tile its own program, and there are dozens of tiles. The palette is mixed per vertex from
   * three biomes. And the mow direction rides in per vertex too.
   */
  readonly course: boolean;
  /**
   * Course path only. Anything but "off" samples the packed detail arrays (`groundTextures.ts`):
   * grain and normal detail near the camera, a macro sample against tiling, a warped fairway
   * edge and the mow-stripe sheen. "full" adds a second, rotated near sample. "off" compiles the
   * flat ground exactly as it was before there were textures.
   */
  readonly detail?: GroundDetailMode;
}

const g = (n: number): string => n.toFixed(4);

/** Declarations for the detail path: samplers, the warp, and what the three chunks share. */
function detailDeclaration(): string {
  return `
         uniform highp sampler2DArray uGroundDetail;
         uniform highp sampler2DArray uGroundNormal;
         uniform vec2 uMaskMetres;
${GROUND_WARP_GLSL}
         // Written by the colour chunk, read by the roughness and normal chunks after it.
         vec2 gUvA; vec2 gUvB; vec2 gGradAx; vec2 gGradAy; vec2 gGradBx; vec2 gGradBy;
         float gLayerA; float gWeightB; float gIsSand; float gDetailFade;
         float gBandSign; float gMown; vec2 gMowDir; vec2 gNormalTilt;`;
}

/**
 * The detail multiplier for the colour chunk. Two "slots" are sampled, never all five layers:
 * slot A is mown grass, or sand inside a bunker; slot B is coarse grass, weighted by how far
 * into the rough the pixel is.
 *
 * Every fetch uses explicit gradients taken from the world position. The two slots' UVs jump
 * where the layer changes, and an implicit-derivative fetch across that jump picks a tiny mip
 * for one pixel and draws a line along every bunker edge.
 */
function detailColour(full: boolean): string {
  const t = GROUND_DETAIL_TUNING;
  const mown = GROUND_LAYERS[LAYER.mown]!;
  const coarse = GROUND_LAYERS[LAYER.coarse]!;
  const sand = GROUND_LAYERS[LAYER.sand]!;
  return `
           {
             vec2 p = vGroundWorldPos.xz;
             vec2 dpx = dFdx(p);
             vec2 dpy = dFdy(p);
             // Mown grass is sampled in the mow frame, so its grain runs with the stripes.
             vec2 perp = vec2(-fairwayDir.y, fairwayDir.x);
             mat2 toMow = mat2(fairwayDir.x, perp.x, fairwayDir.y, perp.y);
             gIsSand = step(0.5, wSand);
             gMowDir = fairwayDir;
             if (gIsSand > 0.5) {
               gUvA = p / ${g(sand.scaleM)};
               gGradAx = dpx / ${g(sand.scaleM)};
               gGradAy = dpy / ${g(sand.scaleM)};
               gLayerA = ${LAYER.sand}.0;
             } else {
               gUvA = (toMow * p) / ${g(mown.scaleM)};
               gGradAx = (toMow * dpx) / ${g(mown.scaleM)};
               gGradAy = (toMow * dpy) / ${g(mown.scaleM)};
               gLayerA = ${LAYER.mown}.0;
             }
             gUvB = p / ${g(coarse.scaleM)};
             gGradBx = dpx / ${g(coarse.scaleM)};
             gGradBy = dpy / ${g(coarse.scaleM)};
             gWeightB = wCorridor * (1.0 - gIsSand);

             float strengthA = mix(${g(mown.strength)} * mix(${g(t.greenStrength)}, 1.0, wGreen), ${g(sand.strength)}, gIsSand);
             float dA = textureGrad(uGroundDetail, vec3(gUvA, gLayerA), gGradAx, gGradAy).r * ${g(DETAIL_RANGE)};
             float dB = textureGrad(uGroundDetail, vec3(gUvB, ${LAYER.coarse}.0), gGradBx, gGradBy).r * ${g(DETAIL_RANGE)};
             float macro = textureGrad(uGroundDetail, vec3(p / ${g(MACRO_SCALE_M)}, ${LAYER.coarse}.0), dpx / ${g(MACRO_SCALE_M)}, dpy / ${g(MACRO_SCALE_M)}).r * ${g(DETAIL_RANGE)};
${
  full
    ? `             // Anti-tiling: the same layers again, turned 40 degrees and a little larger, taking over
             // where the macro sample is bright. No two repeats of the fine grain line up.
             const mat2 turn = mat2(0.7660, 0.6428, -0.6428, 0.7660);
             float dA2 = textureGrad(uGroundDetail, vec3(turn * gUvA / 1.15, gLayerA), turn * gGradAx / 1.15, turn * gGradAy / 1.15).r * ${g(DETAIL_RANGE)};
             float dB2 = textureGrad(uGroundDetail, vec3(turn * gUvB / 1.15, ${LAYER.coarse}.0), turn * gGradBx / 1.15, turn * gGradBy / 1.15).r * ${g(DETAIL_RANGE)};
             float swap = smoothstep(0.85, 1.15, macro);
             dA = mix(dA, dA2, swap);
             dB = mix(dB, dB2, swap);`
    : ""
}
             float near = mix(mix(1.0, dA, strengthA), mix(1.0, dB, ${g(coarse.strength)}), gWeightB);
             float macroFade = 1.0 - smoothstep(${g(t.macroFadeStartM)}, ${g(t.macroFadeEndM)}, groundDist);
             float detail = mix(1.0, near, gDetailFade) * mix(1.0, macro, ${g(MACRO_STRENGTH)} * macroFade);
             // Not under the water tint: the pond surface draws its own detail.
             grass *= mix(detail, 1.0, wWater);
           }`;
}

function paletteDeclaration(course: boolean): string {
  if (!course) {
    return `
         uniform vec3 uGreen;
         uniform vec3 uFairway;
         uniform vec3 uRough;
         uniform vec3 uSand;
         uniform vec3 uWater;
         uniform float uStripeAngle;`;
  }
  // Three of everything: one set per biome, mixed by the vertex weights. Declared as arrays so
  // the mixing below is a loop rather than fifteen named uniforms multiplied out by hand.
  return `
         uniform vec3 uGreenBiome[3];
         uniform vec3 uFairwayBiome[3];
         uniform vec3 uRoughBiome[3];
         uniform vec3 uSandBiome[3];
         uniform vec3 uWaterBiome[3];
         varying vec2 vGroundMow;
         varying vec3 vGroundBiome;`;
}

function paletteBody(course: boolean): string {
  if (!course) {
    return `
           vec3 cGreen = uGreen;
           vec3 cFairway = uFairway;
           vec3 cRough = uRough;
           vec3 cSand = uSand;
           vec3 cWater = uWater;
           // Greens are mown finer and at a right angle to the fairway. Both directions come from
           // the hole's one angle.
           vec2 fairwayDir = vec2(cos(uStripeAngle), sin(uStripeAngle));
           vec2 greenDir = vec2(cos(uStripeAngle + 1.5707963), sin(uStripeAngle + 1.5707963));`;
  }
  return `
           vec3 bw = vGroundBiome;
           // Normalised so ground no hole reaches -- where every weight is 0 -- takes the first
           // biome rather than going black.
           float bwSum = bw.r + bw.g + bw.b;
           bw = bwSum > 0.0001 ? bw / bwSum : vec3(1.0, 0.0, 0.0);
           vec3 cGreen = uGreenBiome[0] * bw.r + uGreenBiome[1] * bw.g + uGreenBiome[2] * bw.b;
           vec3 cFairway = uFairwayBiome[0] * bw.r + uFairwayBiome[1] * bw.g + uFairwayBiome[2] * bw.b;
           vec3 cRough = uRoughBiome[0] * bw.r + uRoughBiome[1] * bw.g + uRoughBiome[2] * bw.b;
           vec3 cSand = uSandBiome[0] * bw.r + uSandBiome[1] * bw.g + uSandBiome[2] * bw.b;
           vec3 cWater = uWaterBiome[0] * bw.r + uWaterBiome[1] * bw.g + uWaterBiome[2] * bw.b;
           // A zero-length direction means unmown ground; any direction does there, because the
           // stripe is faded out to nothing by mownAmount below.
           vec2 fairwayDir = length(vGroundMow) > 0.0001 ? normalize(vGroundMow) : vec2(1.0, 0.0);
           vec2 greenDir = vec2(-fairwayDir.y, fairwayDir.x);`;
}

/**
 * Rewrites a `MeshStandardMaterial`'s shader in `onBeforeCompile`.
 *
 * Built on the standard material rather than as a `ShaderMaterial` because the ground still wants
 * three's own lighting, fog and tonemapping, and reimplementing those to gain a colour lookup
 * would be a large amount of shader to keep in step with three's.
 */
export function applyGroundShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  options: GroundShaderOptions,
): void {
  const perVertex = options.course
    ? `
         attribute vec2 aMow;
         attribute vec3 aBiome;
         varying vec2 vGroundMow;
         varying vec3 vGroundBiome;`
    : "";
  const perVertexAssign = options.course ? "vGroundMow = aMow;\n         vGroundBiome = aBiome;" : "";
  // The course reads the mask out of the material's own map slot; a hole reads it from a uniform.
  const sample = options.course
    ? "texture2D(map, vMapUv)"
    : "texture2D(uMask, vGroundWorldPos.xz / uMaskExtent + uMaskOffset)";
  // `map_fragment` would multiply the mask straight into diffuseColor, which is not what a mask
  // is, so on the course path it is replaced rather than appended to.
  const mapPreamble = options.course ? "" : "#include <map_fragment>\n";
  const detail: GroundDetailMode = options.course ? (options.detail ?? "off") : "off";
  const detailed = detail !== "off";
  const t = GROUND_DETAIL_TUNING;
  const maskUniforms = options.course
    ? ""
    : `
         uniform sampler2D uMask;
         uniform vec2 uMaskExtent;
         uniform vec2 uMaskOffset;`;

  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
         varying vec3 vGroundWorldPos;${perVertex}`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
         vGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         ${perVertexAssign}`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
         varying vec3 vGroundWorldPos;${maskUniforms}${paletteDeclaration(options.course)}${detailed ? detailDeclaration() : ""}

         // Two-tone band. The bands run perpendicular to the mow direction, which is why the
         // projection is onto the direction rather than along it.
         float mowBand(vec2 p, vec2 dir, float width) {
           float axis = dot(p, dir);
           return step(0.5, fract(axis / width));
         }`,
    )
    .replace(
      "#include <map_fragment>",
      `${mapPreamble}         {
           vec4 m = ${sample};
${
  detailed
    ? `           float groundDist = distance(cameraPosition, vGroundWorldPos);
           gDetailFade = 1.0 - smoothstep(${g(DETAIL_FADE_START_M)}, ${g(DETAIL_FADE_END_M)}, groundDist);
           {
             // The grass edges wander: green and corridor weights are read through the warp. Sand
             // and water are not, because the pond surface and the bunkers are placed against
             // the unwarped shapes. The warp dies away at a tile's edge, where the mask clamps.
             vec2 toEdge = min(vMapUv, 1.0 - vMapUv) * uMaskMetres;
             float inside = smoothstep(0.0, ${g(t.warpEdgeM)}, min(toEdge.x, toEdge.y));
             vec2 warp = groundWarp(vGroundWorldPos.xz) * gDetailFade * inside;
             m.rg = texture2D(map, vMapUv + warp / uMaskMetres).rg;
           }`
    : ""
}
           float wGreen = m.r;      // 0 on the putting green, 1 off it
           float wCorridor = m.g;   // 0 on the mown corridor, 1 in full rough
           float wSand = m.b;
           float wWater = m.a;
${paletteBody(options.course)}

           // The same nested blend surfaces.ts uses for tuning: green -> fairway -> rough.
           vec3 mown = mix(cGreen, cFairway, wGreen);
           vec3 grass = mix(mown, cRough, wCorridor);

           // Greens are mown finer and at a right angle to the fairway. That contrast is what
           // makes a green read as a distinct surface from across the hole.
           float fairwayBand = mowBand(vGroundWorldPos.xz, fairwayDir, ${FAIRWAY_STRIPE_M.toFixed(1)});
           float greenBand = mowBand(vGroundWorldPos.xz, greenDir, ${GREEN_STRIPE_M.toFixed(1)});
           float band = mix(greenBand, fairwayBand, wGreen);

           // Stripes fade out into the rough: unmown grass has no mowing pattern.
           float mownAmount = 1.0 - wCorridor;
           float stripe = mix(1.0, mix(1.0 - ${STRIPE_CONTRAST.toFixed(3)}, 1.0 + ${STRIPE_CONTRAST.toFixed(3)}, band), mownAmount);
           grass *= stripe;

           grass = mix(grass, cSand, wSand);
           grass = mix(grass, cWater, wWater);
${
  detailed
    ? `           gMown = mownAmount * (1.0 - wSand) * (1.0 - wWater);
           gBandSign = band * 2.0 - 1.0;
${detailColour(detail === "full")}`
    : ""
}
           diffuseColor.rgb *= grass;
         }`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
         // Water is the one surface here that should catch a highlight.
         roughnessFactor = mix(roughnessFactor, 0.18, ${sample}.a);
${
  detailed
    ? `         {
           // The layers' normals and roughness, fetched once here for both this chunk and the
           // normal chunk below. RG is the tangent-space normal, B the roughness.
           vec4 nA = textureGrad(uGroundNormal, vec3(gUvA, gLayerA), gGradAx, gGradAy);
           vec4 nB = textureGrad(uGroundNormal, vec3(gUvB, ${LAYER.coarse}.0), gGradBx, gGradBy);
           vec2 tiltA = nA.rg * 2.0 - 1.0;
           // Slot A's normal is in the mow frame unless it is sand; turn it back to world XZ.
           vec2 perp = vec2(-gMowDir.y, gMowDir.x);
           tiltA = mix(gMowDir * tiltA.x + perp * tiltA.y, tiltA, gIsSand);
           vec2 tiltB = nB.rg * 2.0 - 1.0;
           // The ground is close enough to level that world X and Z stand in for the tangent
           // frame; on a steep bank the grain is slightly foreshortened, which nobody can see.
           gNormalTilt = mix(tiltA, tiltB, gWeightB) * (${g(t.normalStrength)} * gDetailFade);
           // The sheen does not fade with the fine detail: stripes read from across the hole.
           gNormalTilt += gMowDir * (gBandSign * ${g(t.sheenTilt)} * gMown);
           float layerRough = mix(nA.b, nB.b, gWeightB);
           float matte = mix(${g(t.roughnessFloor)}, ${g(t.roughnessCeil)}, layerRough);
           roughnessFactor = mix(roughnessFactor, matte, gDetailFade);
           roughnessFactor = clamp(roughnessFactor - gBandSign * ${g(t.sheenRoughness)} * gMown, ${g(t.roughnessFloor - 0.04)}, 1.0);
         }`
    : ""
}`,
    );
  if (detailed) {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
         normal = normalize(normal + (viewMatrix * vec4(gNormalTilt.x, 0.0, gNormalTilt.y, 0.0)).xyz);`,
    );
  }
}
