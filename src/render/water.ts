import * as THREE from "three";
import type { PlacedHole } from "../sim/courseTerrain";
import { SurfaceId } from "../sim/surfaceId";
import type { Surfaces } from "../sim/surfaces";
import { BIOMES } from "./biomes";
import type { QualityPreset } from "./quality";
import { NOT_WATER_DEPTH_M, RIPPLE_LIFE_S, RIPPLE_SLOTS, RippleRing, buildWaterMesh } from "./waterMesh";

/**
 * The water surface: every pond on the course as one transparent sheet at its water level.
 *
 * Built on `MeshStandardMaterial` for the same reason the ground is: three's own lighting, fog,
 * tonemapping and -- what water most needs -- its environment reflection with a Fresnel term, so
 * the sheet reflects the baked sky (`scene.environment`) at grazing angles and shows its colour
 * looking down. On top of that `onBeforeCompile` adds:
 *
 * - two scrolling layers of procedural wave normals (one on `water: "flat"` presets);
 * - shallow-to-deep teal from the baked depth (`waterMesh.ts`), the biome's water colour as the
 *   middle of the ramp, so shot 03's teal holds and marsh ponds stay peaty;
 * - a foam band where the depth runs out at the bank, broken up by the wave pattern;
 * - ripple rings from the last eight splashes, which bend the normals and whiten the crest.
 *
 * The ground's water tint (`groundShader.ts`, mask channel A) stays underneath: the sheet is
 * see-through in the shallows, and the tinted basin floor is what shows through.
 */

/** Wave and ripple tuning. Shader constants, so a change is one edit here. */
const WATER_TUNING = {
  /**
   * Depth at which the colour reaches the deep end of its ramp, metres. Short, because the ponds
   * are shallow: two-thirds of the sheet is under 1.45 m, and a longer ramp left most of every
   * pond at the pale shallow end. Keep `DEEP_BLOCK_DEPTH_M` in `waterMesh.ts` at or past it.
   */
  deepAtM: 1.0,
  /**
   * Depth at which foam has gone, metres. Small, because the beaches are gentle: at 0.28 m the
   * band ran several metres out from the bank and turned whole shallows white.
   */
  foamToM: 0.07,
  /** Width of the foam band from the shoreline, metres, before the fray widens or narrows it. */
  foamWidthM: 0.8,
  /** Opacity in the shallows and in deep water. */
  shallowAlpha: 0.78,
  deepAlpha: 0.96,
  /** Ring speed, m/s, and ring wavelength, metres. */
  rippleSpeed: 3.2,
  rippleWavelength: 0.9,
  /** Surface roughness: low, so the sky reflects, not so low it reads as glass. */
  roughness: 0.22,
  /**
   * How much of the baked sky the surface reflects. At 1 the reflection washed the teal out to
   * pale blue looking across a pond; concept shot 08 shows almost none. This keeps a Fresnel
   * sheen at grazing angles and the colour everywhere else.
   */
  envMapIntensity: 0.2,
} as const;

export interface WaterSurface {
  /** Null when the course has no water. */
  readonly mesh: THREE.Mesh | null;
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
  quality: Pick<QualityPreset, "water">,
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
    return { mesh: null, ripple() {}, update() {}, dispose() {} };
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(built.positions, 3));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(built.depth, 1));
  geometry.setAttribute("aTint", new THREE.BufferAttribute(built.colour, 3));
  const normals = new Float32Array(built.positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: WATER_TUNING.roughness,
    envMapIntensity: WATER_TUNING.envMapIntensity,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  const uniforms = {
    uWaterTime: { value: 0 },
    uRipples: { value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, -1e4, 0)) },
  };
  const layers = quality.water === "reflective" ? 2 : 1;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    applyWaterShader(shader, layers);
  };
  // One program per layer count; without this three would cache the first compile for both.
  material.customProgramCacheKey = () => `ttt-water-${layers}`;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water";
  // Drawn after the opaque ground and before the sprite smoke, which sits on top of it.
  mesh.renderOrder = 1;
  mesh.frustumCulled = true;

  return {
    mesh,
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

function applyWaterShader(shader: THREE.WebGLProgramParametersWithUniforms, layers: number): void {
  const t = WATER_TUNING;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       attribute float aDepth;
       attribute vec3 aTint;
       varying float vWaterDepth;
       varying vec3 vWaterTint;
       varying vec3 vWaterWorld;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       vWaterDepth = aDepth;
       // The biome colours are sRGB hex, as authored; three lights in linear. The ground's palette
       // goes through THREE.Color, which converts. This attribute does not, so it converts here --
       // without it the water lit as if it were half again as bright and read pale cyan.
       vWaterTint = pow(aTint, vec3(2.2));
       vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       uniform float uWaterTime;
       uniform vec4 uRipples[${RIPPLE_SLOTS}];
       varying float vWaterDepth;
       varying vec3 vWaterTint;
       varying vec3 vWaterWorld;

       // Slope (d/dx, d/dz) of a sum of four directional sine waves: the height itself is never
       // needed, only how it tilts the normal. Each layer is the same sum at its own scale, angle
       // and speed, so the two never line up into a visible repeat.
       vec2 waterSlope(vec2 p, float scale, float angle, float speed, float time) {
         vec2 slope = vec2(0.0);
         for (int i = 0; i < 4; i++) {
           float fi = float(i);
           float a = angle + fi * 1.7;
           vec2 dir = vec2(cos(a), sin(a));
           float k = scale * (1.0 + fi * 0.63);
           float amp = 0.11 / (1.0 + fi * 0.8);
           float phase = dot(p, dir) * k + time * speed * (1.0 + fi * 0.21);
           slope += dir * (amp * cos(phase));
         }
         return slope;
       }

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
      "#include <color_fragment>",
      `#include <color_fragment>
       float waterDeep = smoothstep(0.0, ${glsl(t.deepAtM)}, vWaterDepth);
       // Pulled toward green: concept shot 08's pond is a saturated blue-green, and the biome's
       // water colour on its own reads as sky blue once lit.
       vec3 waterMid = vWaterTint * vec3(0.62, 0.92, 0.8);
       vec3 waterShallow = waterMid * 1.25;
       vec3 waterDeepCol = waterMid * 0.6;
       vec3 waterCol = mix(waterShallow, mix(waterMid, waterDeepCol, smoothstep(0.5, 1.0, waterDeep)), smoothstep(0.0, 0.5, waterDeep));
       diffuseColor.rgb = waterCol;
       diffuseColor.a = mix(${glsl(t.shallowAlpha)}, ${glsl(t.deepAlpha)}, waterDeep);`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
       {
         vec2 p = vWaterWorld.xz;
         vec2 slope = waterSlope(p, 0.55, 0.4, 1.1, uWaterTime);
         ${layers > 1 ? "slope += waterSlope(p, 1.9, 2.3, 1.7, uWaterTime) * 0.55;" : ""}
         vec3 ripple = waterRipples(p, uWaterTime);
         slope += ripple.xy;
         vec3 worldNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
         normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);

         // Foam: a band where the depth runs out at the bank, frayed by the same wave pattern so
         // its edge moves, plus the crest of any ripple ring.
         float fray = 0.5 + 0.5 * sin(dot(p, vec2(0.9, 1.3)) + uWaterTime * 0.8 + slope.x * 9.0);
         // Metres to the shore rather than depth: depth over its own slope. A gentle bank holds a
         // few centimetres of water across metres of beach, so a depth threshold drew a white band
         // there and a hairline on a steep bank. The slope is constant across a triangle (the depth
         // is linear in it), so the screen-space derivatives give it exactly.
         float depthPerPixel = length(vec2(dFdx(vWaterDepth), dFdy(vWaterDepth)));
         float metresPerPixel = max(length(vec2(length(dFdx(p)), length(dFdy(p)))), 1e-4);
         float bankSlope = max(depthPerPixel / metresPerPixel, 0.02);
         float shoreM = max(vWaterDepth, 0.0) / bankSlope;
         float foam = (1.0 - smoothstep(0.0, ${glsl(t.foamWidthM)} * (0.6 + 0.8 * fray), shoreM))
           * (1.0 - smoothstep(0.0, ${glsl(t.foamToM)}, vWaterDepth) * 0.5);
         foam = max(foam, clamp(ripple.z * 0.8, 0.0, 1.0));
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 0.96), foam * 0.75);
         diffuseColor.a = mix(diffuseColor.a, 0.95, foam);
         // Past the shoreline -- under the bank, or off the sim's water -- the sheet is gone.
         diffuseColor.a *= smoothstep(${glsl(NOT_WATER_DEPTH_M)}, 0.0, vWaterDepth);
       }`,
    );
}
