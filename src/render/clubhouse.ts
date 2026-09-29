import * as THREE from "three";
import { mergeGraph, mergeGraphInstances, type MergedGraph } from "../entities/primitiveGraph";
import { kitGraph } from "../entities/kitGraphs";
import {
  BARN_PLACEMENTS,
  CLUBHOUSE_PLACEMENT,
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
 * lot and its lamps behind the building, and the food cart at the pickup depot. Placements
 * come from `src/sim/clubhouseLayout.ts`, the same table the colliders will read.
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

  return {
    group,
    dispose(): void {
      for (const merged of owned) merged.dispose();
      group.clear();
    },
  };
}
