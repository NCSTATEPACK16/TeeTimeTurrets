import type * as THREE from "three";
import { FAIRWAY_STRIPE_M, GREEN_STRIPE_M, STRIPE_CONTRAST } from "./biomes";

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
         varying vec3 vGroundWorldPos;${maskUniforms}${paletteDeclaration(options.course)}

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
           diffuseColor.rgb *= grass;
         }`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
         // Water is the one surface here that should catch a highlight.
         roughnessFactor = mix(roughnessFactor, 0.18, ${sample}.a);`,
    );
}
