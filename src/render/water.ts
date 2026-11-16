import * as THREE from "three";
import type { PlacedHole } from "../sim/courseTerrain";
import { SurfaceId } from "../sim/surfaceId";
import type { Surfaces } from "../sim/surfaces";
import { BIOMES } from "./biomes";
import type { QualityPreset } from "./quality";
import { NOT_WATER_DEPTH_M, RIPPLE_LIFE_S, RIPPLE_SLOTS, RippleRing, buildWaterMesh } from "./waterMesh";

/**
 * The water surface: every pond on the course as one sheet at its water level.
 *
 * **The waves are a GLSL port of "Very fast procedural ocean" by afl_ext** (Shadertoy MdXyzX,
 * 2017; notice in `NOTICE`), by way of the TSL port in the user's GolfCartSimulator project
 * (`apps/web/src/env/oceanWaves.ts`), which tuned it down from an ocean to a still pond. The user
 * named that pond, its hole 13 review level, as the look for water here. What is ported is the
 * wave sum (`exp(sin(x) - 1)` waves, each dragging the next one's sample point), the three-sample
 * normal, the flattening of the normal with distance, and the crest-lit scattered light.
 *
 * Two things differ from the source, both because this is a `MeshStandardMaterial` in a lit
 * scene rather than an unlit shader that owns the whole frame:
 *
 * - **The reflection is this scene's sky.** The source computes its own analytic atmosphere. Here
 *   the surface is a near-mirror dielectric (roughness `WATER_TUNING.roughness`), so three's own
 *   Fresnel reflects `scene.environment`, the baked sky the player sees, and the sun's glitter is
 *   three's specular highlight from the scene's sun.
 * - **The scattered light is emissive.** In the source it is simply added to the pixel. Here the
 *   diffuse colour is black and the scatter term goes to `totalEmissiveRadiance`, so the scene's
 *   lights do not multiply it.
 *
 * What stays from this project's first water: the baked depth (`waterMesh.ts`), which fades the
 * sheet out at the shoreline and thins it over the shallows; the foam line; and ripple rings
 * from the last eight splashes, which now bend the ported normal.
 */

/** Wave, colour and ripple tuning. Shader constants, so a change is one edit here. */
export const WATER_TUNING = {
  // The still-pond setting, from GolfCartSimulator's `envConfig.water`.
  /** Wave units per metre. The base wave is 2 pi units long, so 2.5 gives ripples about 2.5 m long. */
  waveScale: 2.5,
  /** Crest to trough, metres. */
  waveHeight: 0.06,
  /** How strongly each wave drags the next one's sample point. */
  drag: 0.38,
  /** Multiplies the shader's clock. */
  timeScale: 1.0,
  /** How far the normal flattens toward straight up with distance, against shimmer. */
  distanceSmoothing: 0.8,
  /** Light scattered up out of the water, linear RGB, and its strength. Brighter on crests. */
  scatterColor: [0.0293, 0.0698, 0.1717] as readonly [number, number, number],
  scatterStrength: 0.1,
  /** Scales the scattered light for this project's tonemapping. */
  exposure: 1.2,

  // This project's own.
  /** Near-mirror, so the sky reflects; not 0, so the sun's highlight has some width. */
  roughness: 0.06,
  envMapIntensity: 1.0,
  /** Opacity at the shoreline and from `opaqueAtM` of depth on: the bed shows through shallows. */
  shallowAlpha: 0.55,
  opaqueAtM: 0.4,
  /** Depth at which foam has gone, metres, and the foam band's width from the shoreline. */
  foamToM: 0.07,
  foamWidthM: 0.8,
  /** Ring speed, m/s, and ring wavelength, metres. */
  rippleSpeed: 3.2,
  rippleWavelength: 0.9,
} as const;

export interface WaterSurface {
  /** Null when the course has no water. */
  readonly mesh: THREE.Mesh | null;
  /** The shoreline (`WaterMesh.shore`), for bank-side dressing. */
  readonly shore: Float32Array;
  /** A splash at a course point: starts a ripple ring there. */
  ripple(x: number, z: number): void;
  /** Advance the waves. Call once per rendered frame. */
  update(frameSeconds: number): void;
  dispose(): void;
}

export function createWaterSurface(
  holes: readonly PlacedHole[],
  heightAt: (x: number, z: number) => number,
  surfaces: Pick<Surfaces, "surfaceAt">,
  quality: Pick<QualityPreset, "waterIterations">,
): WaterSurface {
  const built = buildWaterMesh(
    holes,
    heightAt,
    (x, z) => surfaces.surfaceAt(x, z) === SurfaceId.Water,
    (hole) => BIOMES[hole.spec.biome].water,
  );
  const ring = new RippleRing();
  let time = 0;
  if (built.indices.length === 0) {
    return { mesh: null, shore: built.shore, ripple() {}, update() {}, dispose() {} };
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(built.positions, 3));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(built.depth, 1));
  const normals = new Float32Array(built.positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: WATER_TUNING.roughness,
    metalness: 0,
    envMapIntensity: WATER_TUNING.envMapIntensity,
    transparent: true,
    depthWrite: false,
  });
  const uniforms = {
    uWaterTime: { value: 0 },
    uRipples: { value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, -1e4, 0)) },
  };
  const iterations = Math.max(1, Math.round(quality.waterIterations));
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    applyWaterShader(shader, iterations);
  };
  // One program per iteration count; without this three would cache the first compile for all.
  material.customProgramCacheKey = () => `ttt-water-${iterations}`;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water";
  // Drawn after the opaque ground and before the sprite smoke, which sits on top of it.
  mesh.renderOrder = 1;

  return {
    mesh,
    shore: built.shore,
    ripple(x, z) {
      ring.push(x, z, time);
    },
    update(frameSeconds) {
      time += frameSeconds;
      uniforms.uWaterTime.value = time;
      const slots = uniforms.uRipples.value;
      for (let i = 0; i < RIPPLE_SLOTS; i++) {
        const o = i * 4;
        slots[i]!.set(ring.data[o]!, ring.data[o + 1]!, ring.data[o + 2]!, ring.data[o + 3]!);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function glsl(n: number): string {
  return n.toFixed(4);
}

/**
 * The ported wave sum as GLSL source, for `iterations` waves. Exported for the smoke check,
 * which runs the same sum in TypeScript (`waterWaves` below) and holds the two to one set of
 * constants.
 */
export function waterWavesGlsl(iterations: number): string {
  const t = WATER_TUNING;
  return `
       // "Very fast procedural ocean" by afl_ext (Shadertoy MdXyzX), getwaves(): a sum of
       // exp(sin) waves, each dragging the sample point along the last one's slope. Returns 0..1.
       float waterWaves(vec2 position, float time) {
         float phaseShift = length(position) * 0.1;
         float iter = 0.0;
         float frequency = 1.0;
         float timeMultiplier = 2.0;
         float weight = 1.0;
         float sumOfValues = 0.0;
         float sumOfWeights = 0.0;
         for (int i = 0; i < ${iterations}; i++) {
           vec2 p = vec2(sin(iter), cos(iter));
           float x = dot(p, position) * frequency + time * timeMultiplier + phaseShift;
           float wave = exp(sin(x) - 1.0);
           float dx = wave * cos(x);
           position += p * (-dx) * weight * ${glsl(t.drag)};
           sumOfValues += wave * weight;
           sumOfWeights += weight;
           weight = mix(weight, 0.0, 0.2);
           frequency *= 1.18;
           timeMultiplier *= 1.07;
           iter += 1232.399963;
         }
         return sumOfValues / sumOfWeights;
       }`;
}

/** The same wave sum in TypeScript: the reference the GLSL above was written from. 0..1. */
export function waterWaves(x: number, z: number, time: number, iterations: number): number {
  let px = x;
  let pz = z;
  const phaseShift = Math.hypot(px, pz) * 0.1;
  let iter = 0;
  let frequency = 1;
  let timeMultiplier = 2;
  let weight = 1;
  let sumOfValues = 0;
  let sumOfWeights = 0;
  for (let i = 0; i < iterations; i++) {
    const dirX = Math.sin(iter);
    const dirZ = Math.cos(iter);
    const phase = (dirX * px + dirZ * pz) * frequency + time * timeMultiplier + phaseShift;
    const wave = Math.exp(Math.sin(phase) - 1);
    const dx = wave * Math.cos(phase);
    px += dirX * -dx * weight * WATER_TUNING.drag;
    pz += dirZ * -dx * weight * WATER_TUNING.drag;
    sumOfValues += wave * weight;
    sumOfWeights += weight;
    weight *= 0.8;
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

function applyWaterShader(shader: THREE.WebGLProgramParametersWithUniforms, iterations: number): void {
  const t = WATER_TUNING;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       attribute float aDepth;
       varying float vWaterDepth;
       varying vec3 vWaterWorld;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       vWaterDepth = aDepth;
       vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       uniform float uWaterTime;
       uniform vec4 uRipples[${RIPPLE_SLOTS}];
       varying float vWaterDepth;
       varying vec3 vWaterWorld;
       // Written by the normal chunk, read by the emissive chunk after it.
       float gWaterHeight;
       float gWaterFoam;
${waterWavesGlsl(iterations)}

       // Ripple rings: slope, and how much crest there is (for the white of the ring).
       vec3 waterRipples(vec2 p, float time) {
         vec3 acc = vec3(0.0);
         for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
           vec4 r = uRipples[i];
           float age = time - r.z;
           if (age < 0.0 || age > ${glsl(RIPPLE_LIFE_S)}) continue;
           vec2 d = p - r.xy;
           float dist = length(d);
           float front = age * ${glsl(t.rippleSpeed)};
           float env = exp(-pow((dist - front) / 0.9, 2.0)) * (1.0 - age / ${glsl(RIPPLE_LIFE_S)}) * r.w;
           float k = 6.2831853 / ${glsl(t.rippleWavelength)};
           float wave = cos((dist - front) * k);
           vec2 dir = dist > 0.001 ? d / dist : vec2(0.0);
           acc.xy += dir * wave * env * 0.45;
           acc.z += max(wave, 0.0) * env;
         }
         return acc;
       }`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
       {
         // afl_ext's normal(): three samples of the wave height, in wave units.
         vec2 world = vWaterWorld.xz;
         float clock = uWaterTime * ${glsl(t.timeScale)};
         vec2 pos = world * ${glsl(t.waveScale)};
         float depthUnits = ${glsl(t.waveHeight * t.waveScale)};
         const float e = 0.01;
         float h0 = waterWaves(pos, clock);
         vec3 a = vec3(pos.x, h0 * depthUnits, pos.y);
         vec3 bx = vec3(pos.x - e, waterWaves(pos - vec2(e, 0.0), clock) * depthUnits, pos.y);
         vec3 bz = vec3(pos.x, waterWaves(pos + vec2(0.0, e), clock) * depthUnits, pos.y + e);
         vec3 n0 = normalize(cross(a - bx, a - bz));
         // Flatten with distance, against shimmer.
         float dist = distance(cameraPosition, vWaterWorld);
         float smoothing = ${glsl(t.distanceSmoothing)} * min(1.0, sqrt(dist * 0.01) * 1.1);
         vec3 worldNormal = mix(n0, vec3(0.0, 1.0, 0.0), smoothing);
         // Ripple rings from splashes bend it too.
         vec3 ripple = waterRipples(world, uWaterTime);
         worldNormal = normalize(worldNormal + vec3(-ripple.x, 0.0, -ripple.y));
         normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
         gWaterHeight = h0;

         // Foam, in metres from the shore rather than by depth: depth over its own slope. A
         // gentle bank holds a few centimetres of water across metres of beach, so a depth
         // threshold drew a white band there and a hairline on a steep bank. The slope is
         // constant across a triangle, so the screen-space derivatives give it exactly.
         float depthPerPixel = length(vec2(dFdx(vWaterDepth), dFdy(vWaterDepth)));
         float metresPerPixel = max(length(vec2(length(dFdx(world)), length(dFdy(world)))), 1e-4);
         float bankSlope = max(depthPerPixel / metresPerPixel, 0.02);
         float shoreM = max(vWaterDepth, 0.0) / bankSlope;
         float fray = 0.5 + 0.5 * sin(dot(world, vec2(0.9, 1.3)) + uWaterTime * 0.8 + h0 * 6.0);
         float foam = (1.0 - smoothstep(0.0, ${glsl(t.foamWidthM)} * (0.6 + 0.8 * fray), shoreM))
           * (1.0 - smoothstep(0.0, ${glsl(t.foamToM)}, vWaterDepth) * 0.5);
         foam = max(foam, clamp(ripple.z * 0.8, 0.0, 1.0));
         gWaterFoam = foam;
         // Foam is the one lit, diffuse thing on the surface.
         diffuseColor.rgb = vec3(0.93, 0.97, 0.96) * (foam * 0.75);
         // Opaque, as in the source, except over the shallows, where the bed shows through, and
         // past the shoreline -- under the bank, or off the sim's water -- where it is gone.
         diffuseColor.a = mix(${glsl(t.shallowAlpha)}, 1.0, smoothstep(0.0, ${glsl(t.opaqueAtM)}, vWaterDepth));
         diffuseColor.a = mix(diffuseColor.a, 0.95, foam);
         diffuseColor.a *= smoothstep(${glsl(NOT_WATER_DEPTH_M)}, 0.0, vWaterDepth);
       }`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       // afl_ext's scattering: light out of the water, brighter on crests. Added, not lit.
       totalEmissiveRadiance += vec3(${t.scatterColor.map(glsl).join(", ")})
         * (${glsl(t.scatterStrength * t.exposure)} * (gWaterHeight + 0.2) * (1.0 - gWaterFoam));`,
    );
}
