import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import type { HolesJson, PathsJson } from '@gcs/level-schema';
// Shared data, not a module: the tee sign's frame as authored for Turrets (art/clubhouse-exterior.blend).
import teeSignJson from '../../../../../src/entities/graphs/tee_sign.json';
import { PathSampler } from '../level/pathSampler';
import { mergeColoured, type ColouredPart } from './colouredGeometry';
import { envConfig } from './envConfig';

/*
 * A tee sign beside every tee: HOLE n / PAR p / N YDS. A port of Turrets' src/render/teeSigns.ts
 * (teeSignLines and its canvas atlas), with the frame rebuilt on free drive's node materials from the
 * same tee_sign.json. No collider. Draws: 2 for all 18 (the frames, the faces).
 */

type Hole = HolesJson['holes'][number];
type Path = PathsJson['paths'][number];
const cfg = envConfig.teeSigns;

export const YARDS_PER_M = 1.0936133;

/**
 * What the sign prints: the length of the hole's cart path (`hNN-path` in paths.json) in yards, but
 * never less than the straight tee-to-pin distance. Some hole paths start well past the tee (hole
 * 12's starts 190 m out), and a hole can't be shorter than the crow flies. With no `hNN-path` (hole 1
 * has an east and a west path), it is the straight distance.
 */
export function holeYards(hole: Hole, paths: Path[]): number {
  const straight = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z);
  const id = `h${String(hole.number).padStart(2, '0')}-path`;
  const path = paths.find((p) => p.id === id);
  let along = 0;
  if (path) {
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!;
      const b = path.points[i]!;
      along += Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
  }
  return Math.round(Math.max(along, straight) * YARDS_PER_M);
}

export function teeSignLines(hole: Hole, yards: number): [string, string, string] {
  return [`HOLE ${hole.number}`, `PAR ${hole.par}`, `${yards} YDS`];
}

export interface TeeSignPlacement {
  readonly hole: number;
  readonly x: number;
  readonly z: number;
  /** Three `rotation.y`. The face (local +Z) points down the hole, from tee toward pin. */
  readonly yaw: number;
  readonly lines: readonly [string, string, string];
}

/**
 * One sign per tee, in hole order (the atlas cell order): `backM` behind the tee and `sideM` to
 * one side of the tee-to-pin line, on whichever side is farther from a cart path.
 */
export function placeTeeSigns(holes: readonly Hole[], paths: Path[], sampler = new PathSampler(paths)): TeeSignPlacement[] {
  return [...holes]
    .sort((a, b) => a.number - b.number)
    .map((hole) => {
      const dx = hole.pin.x - hole.tee.x;
      const dz = hole.pin.z - hole.tee.z;
      const len = Math.hypot(dx, dz);
      const fx = dx / len;
      const fz = dz / len;
      // Right of the heading, looking down the hole: forward x up.
      const rx = -fz;
      const rz = fx;
      const backX = hole.tee.x - fx * cfg.backM;
      const backZ = hole.tee.z - fz * cfg.backM;
      const sides = [1, -1].map((s) => {
        const x = backX + rx * cfg.sideM * s;
        const z = backZ + rz * cfg.sideM * s;
        return { x, z, clear: sampler.nearest(x, z)?.distance ?? Infinity };
      });
      const best = sides[1]!.clear > sides[0]!.clear ? sides[1]! : sides[0]!;
      return {
        hole: hole.number,
        x: best.x,
        z: best.z,
        yaw: Math.atan2(fx, fz),
        lines: teeSignLines(hole, holeYards(hole, paths)),
      };
    });
}

// --- the frame, from tee_sign.json ---------------------------------------------------------------

interface GraphNode {
  name: string;
  kind: string;
  params: number[];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  slot: string;
  children: GraphNode[] | null;
}

interface Graph {
  name: string;
  slots: Record<string, { color: number; roughness: number }>;
  root: GraphNode;
}

const TEE_SIGN_GRAPH = teeSignJson as unknown as Graph;

export interface FrameBox {
  name: string;
  /** Full width, height, depth. */
  size: [number, number, number];
  /** Sign-local: origin at ground contact, face toward +Z. */
  matrix: Matrix4;
  color: number;
}

/** The sign's boxes in sign space: each node's position, XYZ Euler and scale under its parent's. */
export function teeSignBoxes(graph: Graph = TEE_SIGN_GRAPH): FrameBox[] {
  const boxes: FrameBox[] = [];
  const visit = (node: GraphNode, parent: Matrix4) => {
    if (node.kind !== 'box') throw new Error(`${graph.name}: ${node.name} is a ${node.kind}; only boxes are built here`);
    const slot = graph.slots[node.slot];
    if (!slot) throw new Error(`${graph.name}: ${node.name} has no slot ${node.slot}`);
    const local = new Matrix4().compose(
      new Vector3(...node.position),
      new Quaternion().setFromEuler(new Euler(node.rotation[0], node.rotation[1], node.rotation[2], 'XYZ')),
      new Vector3(...node.scale),
    );
    const world = parent.clone().multiply(local);
    boxes.push({ name: node.name, size: [node.params[0]!, node.params[1]!, node.params[2]!], matrix: world, color: slot.color });
    for (const child of node.children ?? []) visit(child, world);
  };
  visit(graph.root, new Matrix4());
  return boxes;
}

// --- rendering (browser) -------------------------------------------------------------------------

export interface TeeSigns {
  readonly group: Group;
  readonly placements: readonly TeeSignPlacement[];
  /** Draw the face atlas once fonts are ready. The faces show the board colour until then. */
  paintFaces(): Promise<void>;
  dispose(): void;
}

export function createTeeSigns(
  holes: readonly Hole[],
  paths: Path[],
  heights: { heightAt(x: number, z: number): number },
  sampler = new PathSampler(paths),
): TeeSigns {
  const placements = placeTeeSigns(holes, paths, sampler);
  const signs = placements.map((p) =>
    new Matrix4().compose(
      new Vector3(p.x, heights.heightAt(p.x, p.z), p.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.yaw),
      new Vector3(1, 1, 1),
    ),
  );

  // Frames: every box of every sign, baked to world space with its slot colour. One draw.
  const boxes = teeSignBoxes();
  const shapes = boxes.map((b) => new BoxGeometry(...b.size));
  const parts: ColouredPart[] = [];
  for (const sign of signs) {
    boxes.forEach((b, k) => parts.push({ geometry: shapes[k]!, color: b.color, matrix: sign.clone().multiply(b.matrix) }));
  }
  const frameGeometry = mergeColoured(parts);
  for (const s of shapes) s.dispose();
  const frameMaterial = new MeshStandardNodeMaterial({ vertexColors: true, roughness: cfg.roughness, metalness: 0 });
  const frames = new Mesh(frameGeometry, frameMaterial);
  frames.name = 'tee-sign-frames';

  // Faces: one plane per sign on the board's front, UVs into its atlas cell, merged. One draw.
  const board = boxes.find((b) => b.name === 'ts_board');
  if (!board) throw new Error('tee_sign.json has no ts_board');
  const [bw, bh, bd] = board.size;
  const { atlas } = cfg.face;
  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = cfg.face.background;
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  const faceTexture = new CanvasTexture(canvas);
  faceTexture.colorSpace = SRGBColorSpace;
  faceTexture.anisotropy = cfg.face.anisotropy;
  const faceGeometry = buildFaces(
    signs,
    board.matrix,
    new PlaneGeometry(bw - 2 * cfg.faceInset, bh - 2 * cfg.faceInset).translate(0, 0, bd / 2 + cfg.faceProud),
  );
  const faceMaterial = new MeshStandardNodeMaterial({ roughness: cfg.roughness, metalness: 0 });
  faceMaterial.map = faceTexture;
  const faces = new Mesh(faceGeometry, faceMaterial);
  faces.name = 'tee-sign-faces';

  const group = new Group();
  group.name = 'tee-signs';
  group.add(frames, faces);

  return {
    group,
    placements,
    paintFaces: async () => {
      await paintSignAtlas(ctx, placements);
      faceTexture.needsUpdate = true;
    },
    dispose: () => {
      frameGeometry.dispose();
      frameMaterial.dispose();
      faceGeometry.dispose();
      faceMaterial.dispose();
      faceTexture.dispose();
    },
  };
}

/** One face plane per sign, baked to world space, with UVs into that sign's atlas cell. Disposes `plane`. */
function buildFaces(signs: readonly Matrix4[], board: Matrix4, plane: PlaneGeometry): BufferGeometry {
  const { atlas } = cfg.face;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const world = new Matrix4();
  signs.forEach((sign, i) => {
    const part = plane.clone().applyMatrix4(world.multiplyMatrices(sign, board));
    const col = i % atlas.cols;
    const row = Math.floor(i / atlas.cols);
    const u0 = (col * atlas.cellW) / atlas.width;
    const u1 = ((col + 1) * atlas.cellW) / atlas.width;
    const v1 = 1 - (row * atlas.cellH) / atlas.height;
    const v0 = 1 - ((row + 1) * atlas.cellH) / atlas.height;
    const base = positions.length / 3;
    const pos = part.getAttribute('position');
    const nor = part.getAttribute('normal');
    const uv = part.getAttribute('uv');
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
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

async function paintSignAtlas(ctx: CanvasRenderingContext2D, placements: readonly TeeSignPlacement[]): Promise<void> {
  const f = cfg.face;
  await Promise.all(f.lines.map(([font]) => document.fonts.load(font, 'HOLE PAR YDS 0123456789')));
  await document.fonts.ready;
  const { atlas } = f;
  ctx.fillStyle = f.background;
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  placements.forEach((p, i) => {
    const x = (i % atlas.cols) * atlas.cellW;
    const y = Math.floor(i / atlas.cols) * atlas.cellH;
    ctx.strokeStyle = f.border.color;
    ctx.lineWidth = f.border.width;
    ctx.strokeRect(x + f.border.inset, y + f.border.inset, atlas.cellW - 2 * f.border.inset, atlas.cellH - 2 * f.border.inset);
    ctx.fillStyle = f.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    f.lines.forEach(([font, ly], k) => {
      ctx.font = font;
      ctx.fillText(p.lines[k]!, x + atlas.cellW / 2, y + ly, atlas.cellW - 4 * f.border.inset);
    });
  });
}
