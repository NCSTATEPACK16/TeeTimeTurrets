import * as THREE from "three";
import { mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import { TEE_SIGN_GRAPH } from "../entities/kitGraphs";
import { toCourseFrame } from "../sim/courseLayout";
import type { PlacedHole } from "../sim/courseTerrain";
import type { HoleSpec } from "../sim/course";

/**
 * A tee sign behind every tee (`docs/art/specs/tee-sign.md`): the first course prop drawn in arena.
 *
 * Its own course-wide pass, not `props.ts`'s per-hole one, so it spends none of
 * `MAX_PROPS_PER_HOLE`. No collider. The face is one `CanvasTexture` atlas drawn from the live
 * `HoleSpec`s, so a sign cannot disagree with its hole.
 */

/** On the tee's centre line, this far behind it. The ball washer and cart-path sign take the sides. */
export const TEE_SIGN_BACK_M = 6;
const YARDS_PER_M = 1.0936133;

export interface TeeSignPlacement {
  readonly hole: number;
  readonly x: number;
  readonly z: number;
  /** Three `rotation.y`. The board's face (local +z) points at the tee. */
  readonly yaw: number;
  readonly lines: readonly [string, string, string];
}

/** The corridor's length in yards: what the sign prints. */
export function holeYards(spec: HoleSpec): number {
  let metres = 0;
  for (let i = 1; i < spec.control.length; i++) {
    const a = spec.control[i - 1]!;
    const b = spec.control[i]!;
    metres += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return Math.round(metres * YARDS_PER_M);
}

export function teeSignLines(spec: HoleSpec): [string, string, string] {
  return [`HOLE ${spec.index + 1}`, `PAR ${spec.par}`, `${holeYards(spec)} YDS`];
}

export function placeTeeSigns(holes: readonly PlacedHole[]): TeeSignPlacement[] {
  const tee = { x: 0, z: 0 };
  const ahead = { x: 0, z: 0 };
  return holes.map((hole) => {
    const spec = hole.spec;
    toCourseFrame(hole.placement, spec.tee.x, spec.tee.z, tee);
    // The same heading props.ts gives the tee furniture: toward the corridor's first bend.
    const toward = spec.control[1] ?? spec.cup;
    toCourseFrame(hole.placement, toward.x, toward.z, ahead);
    const heading = Math.atan2(ahead.z - tee.z, ahead.x - tee.x);
    return {
      hole: spec.index,
      x: tee.x - Math.cos(heading) * TEE_SIGN_BACK_M,
      z: tee.z - Math.sin(heading) * TEE_SIGN_BACK_M,
      // rotation.y takes local +z to (sin yaw, cos yaw); the face must point along the heading.
      yaw: Math.atan2(Math.cos(heading), Math.sin(heading)),
      lines: teeSignLines(spec),
    };
  });
}

// --- rendering ---------------------------------------------------------------------------------

const COLS = 6; // x 3 rows = 18 cells
const CELL_W = 170;
const CELL_H = 119; // the 0.50 x 0.35 face's aspect
const ATLAS_W = 1024;
const ATLAS_H = 512;
const FACE_W = 0.5;
const FACE_H = 0.35;
/** Where the face sits on the sign graph's board (`ts_board`): centre, 15 degrees back, just proud. */
const BOARD_CENTRE = new THREE.Vector3(0, 1.057, -0.03);
const BOARD_TILT = THREE.MathUtils.degToRad(-15);
const FACE_PROUD = 0.022;

export interface TeeSigns {
  readonly objects: readonly THREE.Object3D[];
  dispose(): void;
}

export function createTeeSigns(holes: readonly PlacedHole[], heightAt: (x: number, z: number) => number): TeeSigns {
  const placements = placeTeeSigns(holes);
  const matrices = placements.map((p) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  const frames: MergedGraph = mergeGraphInstances(TEE_SIGN_GRAPH, matrices);

  const atlas = drawAtlas(placements);
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // One plane per sign, UVs into its cell, baked into world space and merged: one draw for all 18.
  const board = new THREE.Matrix4().compose(
    BOARD_CENTRE.clone().add(new THREE.Vector3(0, Math.sin(-BOARD_TILT) * FACE_PROUD, Math.cos(BOARD_TILT) * FACE_PROUD)),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), BOARD_TILT),
    new THREE.Vector3(1, 1, 1),
  );
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const plane = new THREE.PlaneGeometry(FACE_W, FACE_H);
  const world = new THREE.Matrix4();
  placements.forEach((_p, i) => {
    const part = plane.clone().applyMatrix4(world.multiplyMatrices(matrices[i]!, board));
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const u0 = (col * CELL_W) / ATLAS_W;
    const u1 = ((col + 1) * CELL_W) / ATLAS_W;
    const v1 = 1 - (row * CELL_H) / ATLAS_H;
    const v0 = 1 - ((row + 1) * CELL_H) / ATLAS_H;
    const base = positions.length / 3;
    const pos = part.getAttribute("position");
    const nor = part.getAttribute("normal");
    const uv = part.getAttribute("uv");
    for (let k = 0; k < pos.count; k++) {
      positions.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      normals.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      uvs.push(u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    }
    const index = part.getIndex()!;
    for (let k = 0; k < index.count; k++) indices.push(base + index.getX(k));
    part.dispose();
  });
  plane.dispose();
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  faceGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  faceGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  faceGeometry.setIndex(indices);
  const faceMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
  const faces = new THREE.Mesh(faceGeometry, faceMaterial);
  faces.name = "tee-sign-faces";

  return {
    objects: [frames.mesh, faces],
    dispose(): void {
      frames.dispose();
      faceGeometry.dispose();
      faceMaterial.dispose();
      texture.dispose();
    },
  };
}

function drawAtlas(placements: readonly TeeSignPlacement[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d")!;
  placements.forEach((p, i) => {
    const x = (i % COLS) * CELL_W;
    const y = Math.floor(i / COLS) * CELL_H;
    ctx.fillStyle = "#1f4d2e";
    ctx.fillRect(x, y, CELL_W, CELL_H);
    ctx.strokeStyle = "#e8e0c8";
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 5, y + 5, CELL_W - 10, CELL_H - 10);
    ctx.fillStyle = "#f4efdf";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText(p.lines[0], x + CELL_W / 2, y + 36);
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(p.lines[1], x + CELL_W / 2, y + 72);
    ctx.fillText(p.lines[2], x + CELL_W / 2, y + 98);
  });
  return canvas;
}
