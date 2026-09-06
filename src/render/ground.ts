import * as THREE from "three";
import type { Terrain } from "../sim/terrain";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import {
  BIOMES,
  FAIRWAY_STRIPE_M,
  GREEN_STRIPE_M,
  STRIPE_CONTRAST,
} from "./biomes";

/**
 * The course ground: one heightfield mesh, one draw call, coloured from a baked surface mask.
 *
 * The mask stores the *continuous* blend weights `src/sim/surfaces.ts` publishes rather than a
 * discrete surface id. Two reasons, and both matter:
 *
 * 1. It is the same green/fairway/rough falloff the physics blends its rolling resistance with,
 *    read from `weightsAt` rather than recomputed here -- so the visible corridor edge and the
 *    physical one cannot drift apart. A discrete id would have to pick a side of that boundary
 *    and would put a hard, aliased line where the physics has a gradient.
 * 2. It interpolates correctly under a linear filter. Sand and water stay hard-edged, matching
 *    surfaces.ts's own rule that a bunker lip and a water margin are supposed to be abrupt.
 */

/** Metres per mask texel. Half a metre resolves a bunker edge without a visible staircase. */
const MASK_METRES_PER_TEXEL = 0.5;
/** Ceiling on mask resolution, so a large field cannot allocate an unreasonable texture. */
const MASK_MAX = 1024;

export interface Ground {
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

/**
 * Bakes `weightsAt` into an RGBA byte texture.
 *
 * R = green weight, G = corridor weight, B = sand flag, A = water flag. One `SurfaceWeights`
 * scratch object is reused across every texel -- this is a ~360,000-iteration loop on a 300 m
 * field, and allocating in it would be the single largest garbage source in scene setup.
 */
function buildSurfaceMask(terrain: Terrain, surfaces: Surfaces): THREE.DataTexture {
  const { fieldSize } = terrain.spec;
  const size = Math.min(MASK_MAX, Math.ceil(fieldSize / MASK_METRES_PER_TEXEL));
  const data = new Uint8Array(size * size * 4);
  const weights = createSurfaceWeights();

  for (let row = 0; row < size; row++) {
    // Texel centres, not corners: sampling the corner biases every surface half a texel
    // north-west of where it actually is.
    const worldZ = ((row + 0.5) / size - 0.5) * fieldSize;
    for (let col = 0; col < size; col++) {
      const worldX = ((col + 0.5) / size - 0.5) * fieldSize;
      surfaces.weightsAt(worldX, worldZ, weights);
      const i = (row * size + col) * 4;
      data[i] = Math.round(weights.green * 255);
      data[i + 1] = Math.round(weights.corridor * 255);
      data[i + 2] = weights.sand * 255;
      data[i + 3] = weights.water * 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // The mask is weights and flags, not colour: sRGB-decoding it would bend the falloff curve.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Vertex layout matches Rapier's heightfield exactly: PlaneGeometry iterates row-major
 * (row = heightSegments, col = widthSegments) and after rotateX(-90deg) row maps to world Z, col
 * maps to world X -- the same mapping terrain.ts uses for the physics heightfield's column-major
 * heights array (verified empirically against the installed Rapier build).
 */
function buildGroundGeometry(terrain: Terrain): THREE.PlaneGeometry {
  const { fieldSize, cells } = terrain.spec;
  const geometry = new THREE.PlaneGeometry(fieldSize, fieldSize, cells, cells);
  const position = geometry.attributes.position!;
  for (let row = 0; row <= cells; row++) {
    for (let col = 0; col <= cells; col++) {
      const index = row * (cells + 1) + col;
      const worldX = (col / cells - 0.5) * fieldSize;
      const worldZ = (row / cells - 0.5) * fieldSize;
      position.setZ(index, terrain.heightAt(worldX, worldZ));
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Built on MeshStandardMaterial via `onBeforeCompile` rather than as a ShaderMaterial: the
 * ground still wants the standard lighting, fog and tonemapping path, and reimplementing those
 * to gain a colour lookup would be a large amount of shader to keep in step with three's own.
 */
export function createGround(terrain: Terrain, surfaces: Surfaces): Ground {
  const spec = terrain.spec;
  const palette = BIOMES[spec.biome];
  const mask = buildSurfaceMask(terrain, surfaces);
  const geometry = buildGroundGeometry(terrain);

  const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 });

  const uniforms = {
    uMask: { value: mask },
    uFieldSize: { value: spec.fieldSize },
    uStripeAngle: { value: spec.stripeAngle },
    uGreen: { value: new THREE.Color(palette.green) },
    uFairway: { value: new THREE.Color(palette.fairway) },
    uRough: { value: new THREE.Color(palette.rough) },
    uSand: { value: new THREE.Color(palette.sand) },
    uWater: { value: new THREE.Color(palette.water) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vGroundWorldPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vGroundWorldPos;
         uniform sampler2D uMask;
         uniform float uFieldSize;
         uniform float uStripeAngle;
         uniform vec3 uGreen;
         uniform vec3 uFairway;
         uniform vec3 uRough;
         uniform vec3 uSand;
         uniform vec3 uWater;

         // Two-tone band. The bands run perpendicular to the mow direction, which is why the
         // projection is onto (cos a, sin a) rather than along it.
         float mowBand(vec2 p, float angle, float width) {
           float axis = dot(p, vec2(cos(angle), sin(angle)));
           return step(0.5, fract(axis / width));
         }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         {
           vec2 maskUv = vGroundWorldPos.xz / uFieldSize + 0.5;
           vec4 m = texture2D(uMask, maskUv);
           float wGreen = m.r;      // 0 on the putting green, 1 off it
           float wCorridor = m.g;   // 0 on the mown corridor, 1 in full rough
           float wSand = m.b;
           float wWater = m.a;

           // The same nested blend surfaces.ts uses for tuning: green -> fairway -> rough.
           vec3 mown = mix(uGreen, uFairway, wGreen);
           vec3 grass = mix(mown, uRough, wCorridor);

           // Greens are mown finer and at a right angle to the fairway. That contrast is what
           // makes a green read as a distinct surface from across the hole.
           float fairwayBand = mowBand(vGroundWorldPos.xz, uStripeAngle, ${FAIRWAY_STRIPE_M.toFixed(1)});
           float greenBand = mowBand(vGroundWorldPos.xz, uStripeAngle + 1.5707963, ${GREEN_STRIPE_M.toFixed(1)});
           float band = mix(greenBand, fairwayBand, wGreen);

           // Stripes fade out into the rough: unmown grass has no mowing pattern.
           float mownAmount = 1.0 - wCorridor;
           float stripe = mix(1.0, mix(1.0 - ${STRIPE_CONTRAST.toFixed(3)}, 1.0 + ${STRIPE_CONTRAST.toFixed(3)}, band), mownAmount);
           grass *= stripe;

           grass = mix(grass, uSand, wSand);
           grass = mix(grass, uWater, wWater);
           diffuseColor.rgb *= grass;
         }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         // Water is the one surface here that should catch a highlight.
         roughnessFactor = mix(roughnessFactor, 0.18, texture2D(uMask, vGroundWorldPos.xz / uFieldSize + 0.5).a);`,
      );
  };
  // Two materials with the same program cache key share a compiled program, and every hole's
  // ground would otherwise collide on the default key while carrying different uniforms.
  material.customProgramCacheKey = () => `ground-${spec.seed}-${spec.index}`;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;

  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mask.dispose();
    },
  };
}
