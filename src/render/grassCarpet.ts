import * as THREE from "three";
import { RING_M, RING_SIZE, TUFT_STRIDE, cellOf, fillCell, ringCells, tuftsPerCell } from "./grassCells";
import type { TuftQuery } from "./grassCells";
import { TREE_WIND_TIME } from "./Trees";

/**
 * Grass tufts in the rough, in a ring that follows the camera (the Caswell spec, D8). One
 * InstancedMesh, one draw. Where they stand is `grassCells.ts`; this draws them.
 *
 * The pool is cut into slots, one cell's worth of tufts each. When the camera crosses into a new
 * cell, cells that left the ring give up their slots and the nearest new cells are filled into
 * them, at most `FILLS_PER_FRAME` a frame. A slot keeps its tufts until it is reused, so driving
 * back into a cell just left costs nothing. Everything is allocated when the carpet is built.
 *
 * Tufts shrink to nothing over the ring's outer `FADE_M`, in the vertex shader, so cells appear
 * and leave at the edge without a pop; and they sway on the trees' wind clock.
 */

/** Cells filled per frame at most. */
const FILLS_PER_FRAME = 2;
/** Metres over which tufts shrink away at the ring's edge. */
const FADE_M = 10;
/** Sway at a blade's tip, as a fraction of the tuft's height. */
const SWAY = 0.12;

/** Blades per tuft, and their shape in a unit-height tuft. */
const BLADES = 5;
const BLADE_HALF_WIDTH = 0.055;
const BLADE_LEAN = 0.32;
/** Vertex shade at a blade's root and tip: the tip is lighter, as sunlit grass is. */
const ROOT_SHADE = 0.88;
const TIP_SHADE = 1.12;

export interface GrassCarpet {
  readonly mesh: THREE.InstancedMesh;
  /** Bring the ring to the camera. Cheap when the camera has not changed cell. */
  update(cameraX: number, cameraZ: number): void;
  /** Tufts standing in filled slots. For the perf hook and tests. */
  readonly standing: number;
  dispose(): void;
}

/** Five tapered blades in a fan, each two quads, leaning outward. Unit height. */
export function buildTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  // Root, middle, tip: height, half-width share, outward lean share.
  const rows: readonly [number, number, number][] = [
    [0, 1, 0],
    [0.55, 0.7, 0.35],
    [1, 0.08, 1],
  ];
  for (let b = 0; b < BLADES; b++) {
    const angle = (b / BLADES) * Math.PI * 2 + (b % 2) * 0.4;
    const out = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
    const side = new THREE.Vector2(-out.y, out.x);
    // Blades differ a little in height, so a tuft is not a crown.
    const tall = 0.8 + 0.2 * ((b * 3) % BLADES) / (BLADES - 1);
    const base = positions.length / 3;
    for (const [h, width, lean] of rows) {
      const cx = out.x * (0.04 + BLADE_LEAN * lean * tall);
      const cz = out.y * (0.04 + BLADE_LEAN * lean * tall);
      const y = h * tall;
      for (const s of [-1, 1]) {
        positions.push(cx + side.x * BLADE_HALF_WIDTH * width * s, y, cz + side.y * BLADE_HALF_WIDTH * width * s);
        // Mostly up, so a tuft is lit like the ground it stands in rather than like a wall.
        const n = new THREE.Vector3(out.x * 0.3, 1, out.y * 0.3).normalize();
        normals.push(n.x, n.y, n.z);
        const shade = ROOT_SHADE + (TIP_SHADE - ROOT_SHADE) * h;
        colours.push(shade, shade, shade);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const a = base + r * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return geometry;
}

function tuftMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = TREE_WIND_TIME;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n uniform float uTreeTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           // Shrink away over the ring's outer edge, so cells come and go without a pop.
           float fade = 1.0 - smoothstep(${(RING_M - FADE_M).toFixed(1)}, ${RING_M.toFixed(1)}, distance(cameraPosition.xz, root.xz));
           float bend = transformed.y * transformed.y;
           // The sway is a world direction, turned into the tuft's own frame, so a patch of rough
           // leans one way together rather than every tuft its own.
           float phase = uTreeTime * 1.7 + dot(root.xz, vec2(0.071, 0.053));
           vec3 wind = vec3(sin(phase) + 0.35 * sin(phase * 2.3 + 1.7), 0.0, 0.6 * cos(phase * 0.8));
           mat3 frame = mat3(instanceMatrix);
           float size = length(frame[0]);
           transformed += (transpose(frame) * wind) / max(size, 0.0001) * (${SWAY.toFixed(3)} * bend);
           transformed *= fade;
         }`,
      );
    // Blades are double-sided but lit as the ground is: undo three's flip of the back face's
    // normal, which would turn a blade seen from behind dark.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `#include <normal_fragment_begin>
       #ifdef DOUBLE_SIDED
         normal *= faceDirection;
       #endif`,
    );
  };
  material.customProgramCacheKey = () => "ttt-grass-tufts";
  return material;
}

export function createGrassCarpet(query: TuftQuery, density: number, cap: number): GrassCarpet {
  const perCell = tuftsPerCell(density);
  const slots = Math.max(1, Math.floor(cap / perCell));
  const geometry = buildTuftGeometry();
  const material = tuftMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, slots * perCell);
  mesh.name = "grass-tufts";
  mesh.count = 0;
  // Instances spread over a hundred metres round the camera; the unit tuft's bounds say nothing.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);

  const slotX = new Int32Array(slots);
  const slotZ = new Int32Array(slots);
  const slotFilled = new Uint8Array(slots);
  const slotWanted = new Uint8Array(slots);
  const slotCount = new Int32Array(slots);
  const ring = new Int32Array(RING_SIZE * 2);
  const ringSlot = new Int32Array(RING_SIZE);
  const tufts = new Float32Array(perCell * TUFT_STRIDE);
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let pending = false;
  let standing = 0;
  let highWater = 0;

  function slotOf(cx: number, cz: number): number {
    for (let s = 0; s < slots; s++) if (slotFilled[s] && slotX[s] === cx && slotZ[s] === cz) return s;
    return -1;
  }

  /** A slot no ring cell wants: one never filled first, else the first given up. */
  function freeSlot(): number {
    let given = -1;
    for (let s = 0; s < slots; s++) {
      if (slotWanted[s]) continue;
      if (!slotFilled[s]) return s;
      if (given < 0) given = s;
    }
    return given;
  }

  function fill(slot: number, cx: number, cz: number): void {
    const n = fillCell(cx, cz, density, query, tufts);
    const first = slot * perCell;
    for (let i = 0; i < perCell; i++) {
      if (i < n) {
        const o = i * TUFT_STRIDE;
        position.set(tufts[o]!, tufts[o + 1]!, tufts[o + 2]!);
        quaternion.setFromAxisAngle(up, tufts[o + 3]!);
        const h = tufts[o + 4]!;
        scale.set(h, h, h);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(first + i, matrix);
        mesh.setColorAt(first + i, colour.setRGB(tufts[o + 5]!, tufts[o + 6]!, tufts[o + 7]!));
      } else {
        mesh.setMatrixAt(first + i, hidden);
      }
    }
    mesh.instanceMatrix.addUpdateRange(first * 16, perCell * 16);
    mesh.instanceColor!.addUpdateRange(first * 3, perCell * 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    standing += n - (slotFilled[slot] ? slotCount[slot]! : 0);
    slotX[slot] = cx;
    slotZ[slot] = cz;
    slotFilled[slot] = 1;
    slotCount[slot] = n;
    if (slot + 1 > highWater) {
      highWater = slot + 1;
      mesh.count = highWater * perCell;
    }
  }

  return {
    mesh,
    get standing() {
      return standing;
    },
    update(cameraX, cameraZ) {
      const cx = cellOf(cameraX);
      const cz = cellOf(cameraZ);
      if (cx === lastX && cz === lastZ && !pending) return;
      lastX = cx;
      lastZ = cz;
      const cells = ringCells(cameraX, cameraZ, ring);
      slotWanted.fill(0);
      for (let i = 0; i < cells; i++) {
        const slot = slotOf(ring[i * 2]!, ring[i * 2 + 1]!);
        ringSlot[i] = slot;
        if (slot >= 0) slotWanted[slot] = 1;
      }
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceColor!.clearUpdateRanges();
      pending = false;
      let fills = 0;
      for (let i = 0; i < cells; i++) {
        if (ringSlot[i]! >= 0) continue;
        if (fills === FILLS_PER_FRAME) {
          pending = true;
          break;
        }
        const slot = freeSlot();
        // The pool is smaller than the ring: the farthest cells go without.
        if (slot < 0) break;
        slotWanted[slot] = 1;
        fill(slot, ring[i * 2]!, ring[i * 2 + 1]!);
        fills++;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
