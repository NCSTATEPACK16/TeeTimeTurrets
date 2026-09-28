import * as THREE from "three";
import { toCourseFrame } from "../sim/courseGeometry";
import type { CourseTerrain } from "../sim/courseTerrain";
import { polygonSignedDistance } from "../sim/hazards";
import type { QualityPreset } from "./quality";

/**
 * The course's ponds: one transparent surface over every water polygon, in one draw.
 *
 * The ground already colours a pond's bed from the surface mask; this is the surface on top of it,
 * a sheet that catches the sky. Standard-material shading gives it the environment's reflection,
 * brighter at a grazing angle -- the fresnel -- and the shader adds two things:
 *
 * - **A shore fade.** Every vertex carries how far inside its polygon it is (`aShore`), so the
 *   sheet thins to nothing a metre past the bank instead of ending in a hard edge on the grass.
 * - **Ripples**, from Medium up: the normal is tilted by a few travelling sine waves in world
 *   space. Low draws the sheet flat.
 *
 * Decorative and render-only: `src/sim/**` decides what is water, from the same polygons.
 */

/** Grid pitch over a pond's box, metres. */
const CELL_M = 2;
/** How far past the bank the grid extends, so the fade has room. */
const MARGIN_M = 3;
/** The sheet's height above the carved bed. */
const LIFT_M = 0.05;
/** Signed distance (negative inside) at which the sheet is fully clear, and fully there. */
const SHORE_CLEAR_M = 1;
const SHORE_FULL_M = -2;

export interface Water {
  readonly group: THREE.Group;
  readonly animated: boolean;
  /** Advances the ripples to `elapsedSeconds`. */
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createWater(terrain: CourseTerrain, quality: QualityPreset): Water {
  const positions: number[] = [];
  const shores: number[] = [];
  const indices: number[] = [];
  const world = { x: 0, z: 0 };

  for (const hole of terrain.holes) {
    for (const poly of hole.spec.water) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of poly.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const cols = Math.ceil((maxX - minX + 2 * MARGIN_M) / CELL_M);
      const rows = Math.ceil((maxZ - minZ + 2 * MARGIN_M) / CELL_M);
      const base = positions.length / 3;
      const sd: number[] = [];
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const lx = minX - MARGIN_M + c * CELL_M;
          const lz = minZ - MARGIN_M + r * CELL_M;
          const d = polygonSignedDistance(lx, lz, poly);
          sd.push(d);
          toCourseFrame(hole.placement, lx, lz, world);
          positions.push(world.x, hole.spec.waterLevel + LIFT_M, world.z);
          shores.push(smoothstep(SHORE_CLEAR_M, SHORE_FULL_M, d));
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = r * (cols + 1) + c;
          const b = a + 1;
          const d = a + cols + 1;
          const e = d + 1;
          // Only cells that touch the pond: the rest of its box would be triangles drawn clear.
          if (Math.min(sd[a]!, sd[b]!, sd[d]!, sd[e]!) >= SHORE_CLEAR_M) continue;
          indices.push(base + a, base + d, base + b, base + b, base + d, base + e);
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = "water";
  const animated = quality.water === "shaded";
  if (indices.length === 0) {
    return { group, animated, update() {}, dispose() {} };
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aShore", new THREE.Float32BufferAttribute(shores, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0x2a5866,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aShore;\nvarying float vShore;\nvarying vec3 vWaterWorld;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvShore = aShore;\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uWaterTime;\nvarying float vShore;\nvarying vec3 vWaterWorld;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        animated
          ? `#include <normal_fragment_maps>
             {
               // Slopes of three travelling waves, summed: a world-space tilt, turned into view space.
               vec2 p = vWaterWorld.xz;
               float t = uWaterTime;
               vec2 g = vec2(0.0);
               g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * 0.05;
               g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 1.7 + t * 1.9) * 0.03;
               g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 3.1 + t * 2.7) * 0.015;
               vec3 tilt = (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz;
               normal = normalize(normal + tilt);
             }`
          : "#include <normal_fragment_maps>",
      )
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.a *= vShore * 0.85;");
  };
  material.customProgramCacheKey = () => (animated ? "water-rippled" : "water-flat");
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ponds";
  mesh.receiveShadow = true;
  // After the opaque ground, which it lies on and must not hide.
  mesh.renderOrder = 1;
  group.add(mesh);

  return {
    group,
    animated,
    update(elapsedSeconds: number): void {
      if (animated) time.value = elapsedSeconds;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
