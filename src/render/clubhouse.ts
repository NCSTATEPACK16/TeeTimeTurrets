import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGraph, mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import { kitGraph } from "../entities/kitGraphs";
import { dressingGraph } from "../entities/envGraphs";
import {
  BARN_PLACEMENTS,
  CLUBHOUSE_PLACEMENT,
  DRESSING_KINDS,
  DRESSING_PLACEMENTS,
  FOOD_CART_PLACEMENT,
  LAMP_PLACEMENTS,
  LOT_PLACEMENT,
  placedAt,
  type KitPlacement,
} from "../sim/clubhouseLayout";
import type { Vec2 } from "../sim/mapGeometry";
import { TEAM_CANOPY } from "./teamColors";

/**
 * The clubhouse complex in the arena: the clubhouse, a barn behind each team's spawn row, the
 * lot and its lamps behind the building, the food cart at the pickup depot, and the Stage 5a
 * dressing around the front (benches, planters, flagpole, bag rack, welcome sign). Placements come
 * from `src/sim/clubhouseLayout.ts`, the same table the colliders will read.
 *
 * Everything is merged (`mergeGraph`): none of it is repainted, so each piece is one draw. The
 * barns are merged once per team with the team colour baked into `team_trim`. The lamp heads
 * are a separate graph so only they carry an emissive glow.
 */
export interface ClubhouseKit {
  readonly group: THREE.Group;
  dispose(): void;
}

export function createClubhouseKit(centre: Vec2, heightAt: (x: number, z: number) => number): ClubhouseKit {
  const group = new THREE.Group();
  group.name = "clubhouse-kit";
  const owned: MergedGraph[] = [];

  const place = (merged: MergedGraph, p: KitPlacement): void => {
    const at = placedAt(centre, p);
    merged.mesh.position.set(at.x, heightAt(at.x, at.z), at.z);
    merged.mesh.rotation.y = p.yaw;
    group.add(merged.mesh);
    owned.push(merged);
  };

  place(mergeGraph(kitGraph("clubhouse")), CLUBHOUSE_PLACEMENT);
  BARN_PLACEMENTS.forEach((p, team) => {
    place(mergeGraph(kitGraph("team_barn"), { team_trim: TEAM_CANOPY[team as 0 | 1] }), p);
  });
  place(mergeGraph(kitGraph("lot_stripes")), LOT_PLACEMENT);
  place(mergeGraph(kitGraph("food_cart")), FOOD_CART_PLACEMENT);

  // Lamps: all four posts in one draw, all four heads in another, each at its own ground height.
  const lampMatrices = LAMP_PLACEMENTS.map((p) => {
    const at = placedAt(centre, p);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, heightAt(at.x, at.z), at.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
      new THREE.Vector3(1, 1, 1),
    );
  });
  const posts = mergeGraphInstances(kitGraph("lamp_post"), lampMatrices);
  const heads = mergeGraphInstances(kitGraph("lamp_head"), lampMatrices);
  const glow = heads.mesh.material as THREE.MeshStandardMaterial;
  glow.emissive.setHex(0xffd27a);
  glow.emissiveIntensity = 0.8;
  for (const lamp of [posts, heads]) {
    group.add(lamp.mesh);
    owned.push(lamp);
  }

  // Dressing: one draw per kind, every placement of it merged in.
  const placementMatrix = (p: KitPlacement): THREE.Matrix4 => {
    const at = placedAt(centre, p);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, heightAt(at.x, at.z), at.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
      new THREE.Vector3(1, 1, 1),
    );
  };
  for (const kind of DRESSING_KINDS) {
    const matrices = DRESSING_PLACEMENTS.filter((p) => p.kind === kind).map(placementMatrix);
    if (matrices.length === 0) continue;
    const merged = mergeGraphInstances(dressingGraph(kind), matrices);
    group.add(merged.mesh);
    owned.push(merged);
  }
  const signs = DRESSING_PLACEMENTS.filter((p) => p.kind === "welcome_sign").map(placementMatrix);
  const face = signs.length > 0 ? createWelcomeFace(signs) : null;
  if (face) group.add(face.mesh);

  return {
    group,
    dispose(): void {
      for (const merged of owned) merged.dispose();
      face?.dispose();
      group.clear();
    },
  };
}

/** The welcome sign's board (`dr_sign_board` in `dressing.json`): 1.6 x 0.6, centred 1.2 up, 0.06 deep. */
const BOARD_CENTRE_Y = 1.2;
const BOARD_FRONT_Z = 0.03;
const FACE_W = 1.5;
const FACE_H = 0.5;
const FACE_PROUD = 0.005;
const FACE_PX_W = 1024;
const FACE_PX_H = 344; // FACE_W : FACE_H, rounded

/**
 * The lettered face on each welcome sign's board, as a runtime `CanvasTexture` -- the tee signs'
 * technique (`teeSigns.ts`): one plane per sign baked into world space, one draw for all of them.
 */
function createWelcomeFace(signs: readonly THREE.Matrix4[]): MergedGraph {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_PX_W;
  canvas.height = FACE_PX_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1f4d2e";
  ctx.fillRect(0, 0, FACE_PX_W, FACE_PX_H);
  ctx.strokeStyle = "#e8e0c8";
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, FACE_PX_W - 28, FACE_PX_H - 28);
  ctx.fillStyle = "#f4efdf";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 118px sans-serif";
  ctx.fillText("TEE TIME TURRETS", FACE_PX_W / 2, 136);
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("\u00b7 GOLF CLUB \u00b7", FACE_PX_W / 2, 250);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const plane = new THREE.PlaneGeometry(FACE_W, FACE_H);
  plane.translate(0, BOARD_CENTRE_Y, BOARD_FRONT_Z + FACE_PROUD);
  const parts = signs.map((m) => plane.clone().applyMatrix4(m));
  plane.dispose();
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (geometry === null) throw new Error("welcome sign faces failed to merge");
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "welcome-sign-face";
  return {
    mesh,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
